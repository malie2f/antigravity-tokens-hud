import os
import sys
import glob
import time
import json
import sqlite3
import argparse
from datetime import datetime, timedelta, timezone
from collections import defaultdict

CONVERSATIONS_DIR = os.path.expanduser("~/.gemini/antigravity/conversations")
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stats_cache.json")
CACHE_SCHEMA_VERSION = 9


def decode_varint(data, offset):
    res = 0
    shift = 0
    n = len(data)
    while offset < n:
        b = data[offset]
        offset += 1
        res |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return res, offset


def decode_packed_varints(data):
    vals = []
    offset = 0
    n = len(data)
    while offset < n:
        v, offset = decode_varint(data, offset)
        vals.append(v)
    return vals


def parse_proto(data, offset=0, end=None):
    if end is None:
        end = len(data)
    fields = []
    while offset < end:
        tag, offset = decode_varint(data, offset)
        fn = tag >> 3
        wt = tag & 7
        if wt == 0:
            val, offset = decode_varint(data, offset)
            fields.append((fn, "varint", val))
        elif wt == 2:
            length, offset = decode_varint(data, offset)
            val = data[offset : offset + length]
            offset += length
            fields.append((fn, "bytes", val))
        elif wt == 1:
            val = data[offset : offset + 8]
            offset += 8
            fields.append((fn, "fixed64", val))
        elif wt == 5:
            val = data[offset : offset + 4]
            offset += 4
            fields.append((fn, "fixed32", val))
        else:
            break
    return fields


def get_db_signature(db_path):
    try:
        st = os.stat(db_path)
        wal_path = db_path + "-wal"
        if os.path.exists(wal_path):
            wst = os.stat(wal_path)
            return f"{st.st_mtime_ns}:{st.st_size}:{wst.st_mtime_ns}:{wst.st_size}"
        return f"{st.st_mtime_ns}:{st.st_size}:0:0"
    except OSError:
        return ""


def parse_proto_timestamp(raw):
    d = {k: v for k, t, v in parse_proto(raw) if t == "varint"}
    if not d:
        return 0.0
    return d.get(1, 0) + d.get(2, 0) / 1e9


def extract_usage_dict(raw):
    d = {k: v for k, t, v in parse_proto(raw) if t == "varint"}
    p_tok = d.get(2, 0)
    out_tok = d.get(3, 0)
    c_tok = d.get(4, 0) + d.get(5, 0)
    th_tok = d.get(9, 0)
    tx_tok = d.get(10, 0)
    if p_tok > 0 or c_tok > 0 or out_tok > 0:
        return (p_tok, out_tok, c_tok, th_tok, tx_tok)
    return None


def parse_single_db(db_path, sess_id):
    records = []
    fallback_ts = 0
    try:
        wal_path = db_path + "-wal"
        if os.path.exists(wal_path) and os.path.getsize(wal_path) > 0:
            fallback_ts = int(os.path.getmtime(wal_path))
        else:
            fallback_ts = int(os.path.getmtime(db_path))
    except OSError:
        pass

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=1.0)
        c = conn.cursor()

        step_times = {}
        step_details = {}
        compact_steps = []
        try:
            c.execute("SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL")
            for s_idx, meta in c.fetchall():
                t1 = 0.0
                t6 = 0.0
                t7 = 0.0
                s_usage = None
                for fn, wt, val in parse_proto(meta):
                    if wt == "bytes":
                        if fn == 1:
                            t1 = parse_proto_timestamp(val)
                            if t1 > 0:
                                step_times[s_idx] = int(t1)
                        elif fn == 6:
                            t6 = parse_proto_timestamp(val)
                        elif fn == 7:
                            t7 = parse_proto_timestamp(val)
                        elif fn == 9:
                            s_usage = extract_usage_dict(val)
                if s_usage is not None or t1 > 0:
                    step_details[s_idx] = (t1, t6, t7, s_usage)

            # Detect completed context-collapsing checkpoints (step_type=23, status=3, payload.f30.f24=1)
            # Manual `/compact` writes step_type=23 WITHOUT writing to gen_metadata until the next user message!
            c.execute("SELECT idx, step_payload FROM steps WHERE step_type = 23 AND status = 3 ORDER BY idx ASC")
            for s_idx, payload in c.fetchall():
                if not payload:
                    continue
                is_collapse = False
                sum_bytes = 0
                for pfn, pwt, pval in parse_proto(payload):
                    if pfn == 30 and pwt == "bytes":
                        for sfn, swt, sval in parse_proto(pval):
                            if sfn == 24 and swt == "varint" and sval == 1:
                                is_collapse = True
                            elif sfn == 5 and swt == "bytes":
                                sum_bytes = len(sval)
                if is_collapse and sum_bytes > 0:
                    det = step_details.get(s_idx)
                    u = det[3] if det else None
                    sum_tok = (u[4] or u[1]) if u else 0
                    if sum_tok <= 0:
                        sum_tok = max(500, int(round(sum_bytes / 3.2)))
                    compact_steps.append((s_idx, sum_tok))
        except Exception:
            pass

        max_gm_step = -1
        rec_min_steps = []
        try:
            c.execute("SELECT idx, data FROM gen_metadata ORDER BY idx ASC")
            for idx, data in c.fetchall():
                proto = parse_proto(data)
                # Top-level field 2 of CortexStepGeneratorMetadata is repeated uint32 step_indices
                step_indices = []
                for fn, wt, val in proto:
                    if fn == 2:
                        if wt == "bytes":
                            step_indices.extend(decode_packed_varints(val))
                        elif wt == "varint":
                            step_indices.append(val)

                if step_indices:
                    max_s = max(step_indices)
                    if max_s > max_gm_step:
                        max_gm_step = max_s

                ts = 0
                step_attempts = []
                for s_idx in step_indices:
                    st_val = step_times.get(s_idx, 0)
                    if st_val > ts:
                        ts = st_val
                    det = step_details.get(s_idx)
                    if det and det[3] is not None:
                        step_attempts.append(det)
                if ts <= 0:
                    ts = step_times.get(idx, fallback_ts)

                for fn, wt, val in proto:
                    if fn == 1 and wt == "bytes":
                        ttft_s = 0.0
                        stream_s = 0.0
                        retry_cnt = 0
                        model_name = ""
                        max_ctx = 256000
                        est_ctx = 0
                        compact_lim = 0
                        compacted_flag = 0
                        sub_fields = parse_proto(val)

                        s4_entry = None
                        s17_entries = []

                        for sfn, swt, sval in sub_fields:
                            # sfn 19: model name (e.g. gemini-3.8-flash, gemini-4-carbon, claude-sonnet-4-6)
                            if sfn == 19 and swt == "bytes":
                                model_name = sval.decode("utf-8", errors="ignore").lower()
                            # sfn 14: retry count within this turn
                            elif sfn == 14 and swt == "varint":
                                retry_cnt = sval
                            # sfn 11: timeToFirstToken (google.protobuf.Duration)
                            elif sfn == 11 and swt == "bytes":
                                ttft_s = parse_proto_timestamp(sval)
                            # sfn 12: streamingDuration (google.protobuf.Duration)
                            elif sfn == 12 and swt == "bytes":
                                stream_s = parse_proto_timestamp(sval)
                            # sfn 9: chatStartMetadata -> cfn 10: ContextWindowMetadata (f1=est_ctx, f2=compacted_flag, f4=compact_limit)
                            elif sfn == 9 and swt == "bytes":
                                for cfn, cwt, cval in parse_proto(sval):
                                    if cfn == 10 and cwt == "bytes":
                                        ctx_fields = {
                                            k: v for k, t, v in parse_proto(cval) if t == "varint"
                                        }
                                        est_ctx = ctx_fields.get(1, 0)
                                        compacted_flag = ctx_fields.get(2, 0)
                                        compact_lim = ctx_fields.get(4, 0)
                            # sfn 4: cumulative exa.codeium_common_pb.ModelUsageStats (sums retries)
                            elif sfn == 4 and swt == "bytes" and s4_entry is None:
                                s4_entry = extract_usage_dict(sval)
                            # sfn 17: per-attempt generator call records
                            elif sfn == 17 and swt == "bytes":
                                for tfn, twt, tval in parse_proto(sval):
                                    if tfn == 2 and twt == "bytes":
                                        u = extract_usage_dict(tval)
                                        if u:
                                            s17_entries.append(u)
                                            break

                        # Prefer exact server-enforced auto-compaction threshold from Protobuf (cfn10.f4)
                        if compact_lim > 0:
                            max_ctx = compact_lim
                        elif "claude" in model_name:
                            max_ctx = 840000 if "opus-5" in model_name else 160000
                        elif "gpt" in model_name:
                            max_ctx = 80000
                        elif "3.1" in model_name or "lite" in model_name:
                            max_ctx = 128000
                        else:
                            max_ctx = 256000  # Default 256k auto-compaction threshold for Gemini in Antigravity

                        # Cumulative billed usage for 5h / weekly / historical / heatmap
                        total_entry = s4_entry or (s17_entries[-1] if s17_entries else None)
                        if not total_entry and step_attempts:
                            total_entry = step_attempts[-1][3]

                        if total_entry:
                            p_tok, out_tok, c_tok, th_tok, tx_tok = total_entry

                            # Single-attempt usage for accurate Context Window & Speed (never double-count retries!)
                            if step_attempts:
                                t1, t6, t7, last_u = step_attempts[-1]
                                ctx_p, speed_o, ctx_c, speed_th, speed_tx = last_u
                                real_ttft = max(0.0, t6 - t1) if (t6 > 0 and t1 > 0 and t6 >= t1) else ttft_s
                                real_sdur = max(0.0, t7 - t6) if (t7 > 0 and t6 > 0 and t7 >= t6) else stream_s
                                duration_s = real_ttft + real_sdur
                                if duration_s <= 0.05:
                                    real_ttft = ttft_s
                                    real_sdur = stream_s
                                    duration_s = ttft_s + stream_s
                            else:
                                last_u = s17_entries[-1] if s17_entries else total_entry
                                ctx_p, speed_o, ctx_c, speed_th, speed_tx = last_u
                                real_ttft = ttft_s
                                real_sdur = stream_s
                                # When retry_cnt > 0 without step timestamps, sfn 11 may be averaged across retries
                                if retry_cnt > 0 and len(s17_entries) > 1:
                                    real_ttft = ttft_s * len(s17_entries)
                                duration_s = real_ttft + real_sdur

                            tps = (
                                round(speed_o / duration_s, 1)
                                if duration_s > 0.05 and speed_o > 0
                                else 0.0
                            )
                            rec_min_steps.append(min(step_indices) if step_indices else -1)
                            records.append(
                                {
                                    "idx": idx,
                                    "ts": ts,
                                    "p": p_tok,
                                    "o": out_tok,
                                    "c": c_tok,
                                    "th": th_tok,
                                    "tx": tx_tok,
                                    "ctx_p": ctx_p,
                                    "ctx_c": ctx_c,
                                    "so": speed_o,
                                    "sth": speed_th,
                                    "stx": speed_tx,
                                    "ttft": round(real_ttft, 2),
                                    "sdur": round(real_sdur, 2),
                                    "dur": round(duration_s, 2),
                                    "tps": tps,
                                    "est_ctx": est_ctx,
                                    "max_ctx": max_ctx,
                                    "compacted": 1 if compacted_flag == 2 else 0,
                                }
                            )

            # Handle trailing `/compact` (or auto-compaction) where step_type=23 finished AFTER the last gen_metadata turn
            if records and compact_steps:
                trailing = [cs for cs in compact_steps if cs[0] > max_gm_step]
                if trailing:
                    base_overhead = 13000
                    completed = [cs for cs in compact_steps if cs[0] <= max_gm_step]
                    for prev_c_idx, prev_sum_tok in reversed(completed):
                        if prev_sum_tok <= 0:
                            continue
                        next_rec = None
                        for r_i, min_s in enumerate(rec_min_steps):
                            if min_s > prev_c_idx:
                                next_rec = records[r_i]
                                break
                        if next_rec is not None:
                            obs_ctx = next_rec.get("ctx_p", next_rec["p"]) + next_rec.get("ctx_c", next_rec["c"])
                            if obs_ctx > prev_sum_tok:
                                base_overhead = max(8000, min(30000, obs_ctx - prev_sum_tok))
                                break
                    est_post_ctx = base_overhead + trailing[-1][1]
                    records[-1]["trailing_compact"] = len(trailing)
                    records[-1]["post_compact_ctx"] = est_post_ctx
        except Exception:
            pass
        conn.close()
    except Exception:
        pass

    return records


def load_cache():
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("version") == CACHE_SCHEMA_VERSION:
                    return data.get("dbs", {})
    except Exception:
        pass
    return {}


def save_cache(dbs_cache):
    try:
        tmp_file = CACHE_FILE + ".tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump({"version": CACHE_SCHEMA_VERSION, "dbs": dbs_cache}, f)
        os.replace(tmp_file, CACHE_FILE)
    except Exception:
        pass


def build_session_summary(sess_id, recs, default_max_context=256000):
    if not recs:
        return {
            "session_id": sess_id,
            "context_size": 0,
            "estimated_context": 0,
            "max_context": default_max_context,
            "context_percent": 0.0,
            "compaction_count": 0,
            "cached_tokens": 0,
            "prompt_tokens": 0,
            "cache_hit_percent": 0.0,
            "session_cache_hit_percent": 0.0,
            "session_total_tokens": 0,
            "session_new_tokens": 0,
            "output_tokens": 0,
            "thinking_tokens": 0,
            "text_tokens": 0,
            "speed_tps": 0.0,
            "avg_tps": 0.0,
            "peak_tps": 0.0,
            "ttft_s": 0.0,
            "stream_s": 0.0,
            "duration_s": 0.0,
            "total_turns": 0,
        }

    last = recs[-1]
    trailing_compact = last.get("trailing_compact", 0)
    if trailing_compact > 0 and last.get("post_compact_ctx", 0) > 0:
        ctx = last["post_compact_ctx"]
        est_ctx = ctx
        last_c = 0
        last_p = ctx
        cache_hit_pct = 0.0
    else:
        last_c = last.get("ctx_c", last["c"])
        last_p = last.get("ctx_p", last["p"])
        ctx = last_c + last_p
        est_ctx = last.get("est_ctx") or ctx
        cache_hit_pct = round((last_c / ctx) * 100, 1) if ctx > 0 else 0.0

    sum_c = sum(r["c"] for r in recs)
    sum_p = sum(r["p"] for r in recs)
    sum_o = sum(r["o"] for r in recs)
    sess_cache_hit_pct = round((sum_c / (sum_c + sum_p)) * 100, 1) if (sum_c + sum_p) > 0 else 0.0

    # Find most recent positive max_ctx (auto-compaction threshold) in session, fallback to 256k
    max_context = default_max_context
    for r in reversed(recs):
        if r.get("max_ctx", 0) > 0:
            max_context = r["max_ctx"]
            break

    compaction_count = sum(r.get("compacted", 0) for r in recs) + trailing_compact

    speed_recs = [r for r in recs if r["tps"] > 0 and r["dur"] > 0.05]
    last_speed = speed_recs[-1] if speed_recs else last

    # Session-wide average TPS across all valid turns using single-attempt output tokens & real durations
    sum_out = sum(r.get("so", r["o"]) for r in speed_recs)
    sum_dur = sum(r["dur"] for r in speed_recs)
    avg_tps = round(sum_out / sum_dur, 1) if sum_dur > 0.05 else 0.0
    peak_tps = max((r["tps"] for r in speed_recs), default=0.0)

    return {
        "session_id": sess_id,
        "context_size": ctx,
        "estimated_context": est_ctx,
        "max_context": max_context,
        "context_percent": round((ctx / max_context) * 100, 1) if max_context > 0 else 0.0,
        "compaction_count": compaction_count,
        "cached_tokens": last_c,
        "prompt_tokens": last_p,
        "cache_hit_percent": cache_hit_pct,
        "session_cache_hit_percent": sess_cache_hit_pct,
        "session_total_tokens": sum_c + sum_p + sum_o,
        "session_new_tokens": sum_p + sum_o,
        "output_tokens": last_speed.get("so", last_speed["o"]),
        "thinking_tokens": last_speed.get("sth", last_speed["th"]),
        "text_tokens": last_speed.get("stx", last_speed["tx"]),
        "speed_tps": last_speed["tps"],
        "avg_tps": avg_tps,
        "peak_tps": peak_tps,
        "ttft_s": last_speed.get("ttft", 0.0),
        "stream_s": last_speed.get("sdur", 0.0),
        "duration_s": last_speed["dur"],
        "total_turns": len(recs),
    }


def get_effective_mtime(db_path):
    try:
        m = os.path.getmtime(db_path)
        wal = db_path + "-wal"
        if os.path.exists(wal) and os.path.getsize(wal) > 0:
            m = max(m, os.path.getmtime(wal))
        return m
    except OSError:
        return 0


def collect_metrics(current_conv_id=None):
    now_ts = int(time.time())
    db_files = glob.glob(os.path.join(CONVERSATIONS_DIR, "*.db"))
    db_files.sort(key=get_effective_mtime, reverse=True)

    if not current_conv_id and db_files:
        current_conv_id = os.path.basename(db_files[0]).replace(".db", "")

    dbs_cache = load_cache()
    cache_dirty = False
    active_sess_ids = set()

    sessions_map = {}
    all_records = []
    latest_ts = 0

    for db_path in db_files:
        sess_id = os.path.basename(db_path).replace(".db", "")
        active_sess_ids.add(sess_id)
        sig = get_db_signature(db_path)

        cached_entry = dbs_cache.get(sess_id)
        if cached_entry and cached_entry.get("sig") == sig:
            recs = cached_entry.get("recs", [])
        else:
            recs = parse_single_db(db_path, sess_id)
            if not cached_entry or cached_entry.get("sig") != sig:
                dbs_cache[sess_id] = {"sig": sig, "recs": recs}
                cache_dirty = True

        sessions_map[sess_id] = build_session_summary(sess_id, recs)
        for r in recs:
            ts = r["ts"]
            if ts > latest_ts:
                latest_ts = ts
            all_records.append((sess_id, r))

    stale_keys = [k for k in dbs_cache if k not in active_sess_ids]
    for k in stale_keys:
        del dbs_cache[k]
        cache_dirty = True

    if cache_dirty:
        save_cache(dbs_cache)

    ref_ts = max(latest_ts, now_ts)
    h5_ts = ref_ts - (5 * 3600)
    w1_ts = ref_ts - (7 * 86400)

    def summarize_window(filtered):
        inp = sum(r["p"] for _, r in filtered)
        out = sum(r["o"] for _, r in filtered)
        cac = sum(r["c"] for _, r in filtered)
        thk = sum(r["th"] for _, r in filtered)
        tot_in = cac + inp
        hit_pct = round((cac / tot_in) * 100, 1) if tot_in > 0 else 0.0
        return {
            "total_requests": len(filtered),
            "input_tokens": inp,
            "output_tokens": out,
            "cached_tokens": cac,
            "thinking_tokens": thk,
            "cache_hit_percent": hit_pct,
            "new_tokens": inp + out,
            "total_tokens": cac + inp + out,
        }

    h5_recs = [(s, r) for s, r in all_records if r["ts"] >= h5_ts]
    w1_recs = [(s, r) for s, r in all_records if r["ts"] >= w1_ts]

    u5h = summarize_window(h5_recs)
    u5h["window_hours"] = 5

    u_weekly = summarize_window(w1_recs)
    u_weekly["window_days"] = 7

    u_hist = summarize_window(all_records)
    u_hist["total_sessions"] = len(db_files)

    by_date = defaultdict(lambda: {"tokens": 0, "new_tokens": 0, "requests": 0})
    for _, r in all_records:
        if r["ts"] > 0:
            dt_str = datetime.fromtimestamp(r["ts"]).strftime("%Y-%m-%d")
            d_bucket = by_date[dt_str]
            d_bucket["tokens"] += r["c"] + r["p"] + r["o"]
            d_bucket["new_tokens"] += r["p"] + r["o"]
            d_bucket["requests"] += 1

    today_local = datetime.fromtimestamp(now_ts).date()
    today_row = (today_local.weekday() + 1) % 7
    num_weeks = 25
    grid_start = today_local - timedelta(days=today_row + (num_weeks - 1) * 7)

    daily_cells = []
    month_labels = []
    last_month = None
    for col in range(num_weeks):
        col_first_day = grid_start + timedelta(days=col * 7)
        for r_idx in range(7):
            d_cur = col_first_day + timedelta(days=r_idx)
            if d_cur <= today_local and d_cur.month != last_month:
                if col == 0 or d_cur.day <= 7:
                    month_labels.append({"col": col, "label": f"{d_cur.month}月"})
                    last_month = d_cur.month
                break
        for row in range(7):
            d_cur = col_first_day + timedelta(days=row)
            d_str = d_cur.strftime("%Y-%m-%d")
            is_future = d_cur > today_local
            stat = by_date.get(d_str)
            daily_cells.append(
                {
                    "date": d_str,
                    "label": f"{d_cur.month}月{d_cur.day}日",
                    "col": col,
                    "row": row,
                    "future": is_future,
                    "tokens": 0 if is_future else (stat["tokens"] if stat else 0),
                    "new_tokens": 0 if is_future else (stat["new_tokens"] if stat else 0),
                    "requests": 0 if is_future else (stat["requests"] if stat else 0),
                }
            )

    current_week_start = today_local - timedelta(days=today_row)
    weekly_bars = []
    for w_offset in range(11, -1, -1):
        ws = current_week_start - timedelta(days=w_offset * 7)
        we = min(ws + timedelta(days=6), today_local)
        w_tok = 0
        w_new = 0
        w_req = 0
        for d_off in range(7):
            dc = ws + timedelta(days=d_off)
            if dc > today_local:
                break
            st = by_date.get(dc.strftime("%Y-%m-%d"))
            if st:
                w_tok += st["tokens"]
                w_new += st["new_tokens"]
                w_req += st["requests"]
        weekly_bars.append(
            {
                "label": f"{ws.month}/{ws.day}",
                "range": f"{ws.month}月{ws.day}日 - {we.month}月{we.day}日",
                "tokens": w_tok,
                "new_tokens": w_new,
                "requests": w_req,
            }
        )

    curr_sess = sessions_map.get(current_conv_id) or build_session_summary(
        current_conv_id or "new", []
    )
    global_speed_recs = [
        r for _, r in sorted(all_records, key=lambda x: x[1]["ts"]) if r["tps"] > 0
    ]
    fallback_rec = global_speed_recs[-1] if global_speed_recs else None

    eff_tps = curr_sess["speed_tps"] or (fallback_rec["tps"] if fallback_rec else 0.0)
    eff_dur = curr_sess["duration_s"] or (fallback_rec["dur"] if fallback_rec else 0.0)
    eff_ttft = curr_sess["ttft_s"] or (fallback_rec.get("ttft", 0.0) if fallback_rec else 0.0)
    eff_sdur = curr_sess["stream_s"] or (fallback_rec.get("sdur", 0.0) if fallback_rec else 0.0)
    eff_out = curr_sess["output_tokens"] or (fallback_rec.get("so", fallback_rec["o"]) if fallback_rec else 0)

    return {
        "current_session": curr_sess,
        "sessions": sessions_map,
        "latest_turn_ts": latest_ts,
        "speed": {
            "tps": eff_tps,
            "avg_tps": curr_sess["avg_tps"],
            "peak_tps": curr_sess["peak_tps"],
            "ttft_s": eff_ttft,
            "stream_s": eff_sdur,
            "duration_s": eff_dur,
            "output_tokens": eff_out,
            "thinking_tokens": curr_sess["thinking_tokens"],
            "text_tokens": curr_sess["text_tokens"],
        },
        "usage_5h": u5h,
        "usage_weekly": u_weekly,
        "usage_historical": u_hist,
        "activity": {
            "num_weeks": num_weeks,
            "daily": daily_cells,
            "months": month_labels,
            "weekly": weekly_bars,
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Antigravity Tokens Extractor")
    parser.add_argument("--json", action="store_true", help="Output JSON format")
    parser.add_argument("--session", type=str, default=None, help="Specific session ID")
    args = parser.parse_args()

    metrics = collect_metrics(args.session)
    print(json.dumps(metrics))
