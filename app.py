import sqlite3
import csv
import io
import socket
import base64
import qrcode
from datetime import datetime, date
from flask import Flask, render_template, request, redirect, url_for, jsonify, Response

app = Flask(__name__)
DB = "inspection.db"

DEFAULT_DEFECTS = [
    "汚れ",
    "破損",
    "縫製不良",
    "サイズ違い",
    "色違い",
    "タグ不良",
    "数量不足",
    "その他",
]


def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS defect_types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS inspection_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                worker TEXT NOT NULL,
                hinban TEXT NOT NULL,
                defect_type TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                recorded_at TEXT NOT NULL
            )
        """)
        for name in DEFAULT_DEFECTS:
            conn.execute(
                "INSERT OR IGNORE INTO defect_types (name) VALUES (?)", (name,)
            )
        conn.commit()


init_db()


@app.route("/")
def index():
    with get_db() as conn:
        defects = [r["name"] for r in conn.execute("SELECT name FROM defect_types ORDER BY id")]
    return render_template("index.html", defects=defects)


@app.route("/submit", methods=["POST"])
def submit():
    worker = request.form.get("worker", "").strip()
    hinban = request.form.get("hinban", "").strip()
    recorded_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if not worker or not hinban:
        return redirect(url_for("index"))

    with get_db() as conn:
        defects = [r["name"] for r in conn.execute("SELECT name FROM defect_types ORDER BY id")]
        for defect in defects:
            count = int(request.form.get(f"count_{defect}", 0))
            if count > 0:
                conn.execute(
                    "INSERT INTO inspection_records (worker, hinban, defect_type, count, recorded_at) VALUES (?, ?, ?, ?, ?)",
                    (worker, hinban, defect, count, recorded_at),
                )
        conn.commit()

    return redirect(url_for("summary"))


@app.route("/summary")
def summary():
    today = date.today().strftime("%Y-%m-%d")
    filter_date = request.args.get("date", today)
    filter_worker = request.args.get("worker", "")
    filter_hinban = request.args.get("hinban", "")

    query = "SELECT * FROM inspection_records WHERE DATE(recorded_at) = ?"
    params = [filter_date]
    if filter_worker:
        query += " AND worker = ?"
        params.append(filter_worker)
    if filter_hinban:
        query += " AND hinban = ?"
        params.append(filter_hinban)
    query += " ORDER BY recorded_at DESC"

    with get_db() as conn:
        records = conn.execute(query, params).fetchall()
        workers = [r["worker"] for r in conn.execute(
            "SELECT DISTINCT worker FROM inspection_records WHERE DATE(recorded_at) = ? ORDER BY worker",
            (filter_date,),
        )]
        hinbans = [r["hinban"] for r in conn.execute(
            "SELECT DISTINCT hinban FROM inspection_records WHERE DATE(recorded_at) = ? ORDER BY hinban",
            (filter_date,),
        )]

    # Aggregate: worker x defect_type
    agg = {}
    defect_set = []
    for r in records:
        w = r["worker"]
        d = r["defect_type"]
        if w not in agg:
            agg[w] = {}
        agg[w][d] = agg[w].get(d, 0) + r["count"]
        if d not in defect_set:
            defect_set.append(d)

    # Total per defect
    totals = {}
    for w, counts in agg.items():
        for d, c in counts.items():
            totals[d] = totals.get(d, 0) + c

    return render_template(
        "summary.html",
        records=records,
        agg=agg,
        defect_set=defect_set,
        totals=totals,
        filter_date=filter_date,
        filter_worker=filter_worker,
        filter_hinban=filter_hinban,
        workers=workers,
        hinbans=hinbans,
    )


@app.route("/summary/csv")
def summary_csv():
    today = date.today().strftime("%Y-%m-%d")
    filter_date = request.args.get("date", today)

    with get_db() as conn:
        records = conn.execute(
            "SELECT worker, hinban, defect_type, count, recorded_at FROM inspection_records WHERE DATE(recorded_at) = ? ORDER BY recorded_at",
            (filter_date,),
        ).fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["作業者", "品番", "不良種別", "件数", "記録日時"])
    for r in records:
        writer.writerow([r["worker"], r["hinban"], r["defect_type"], r["count"], r["recorded_at"]])

    return Response(
        "\ufeff" + output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=inspection_{filter_date}.csv"},
    )


@app.route("/defects", methods=["GET", "POST"])
def manage_defects():
    with get_db() as conn:
        if request.method == "POST":
            action = request.form.get("action")
            if action == "add":
                name = request.form.get("name", "").strip()
                if name:
                    conn.execute("INSERT OR IGNORE INTO defect_types (name) VALUES (?)", (name,))
                    conn.commit()
            elif action == "delete":
                defect_id = request.form.get("id")
                if defect_id:
                    conn.execute("DELETE FROM defect_types WHERE id = ?", (defect_id,))
                    conn.commit()
        defects = conn.execute("SELECT * FROM defect_types ORDER BY id").fetchall()
    return render_template("defects.html", defects=defects)


def get_local_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            addr = info[4][0]
            if addr.startswith("192.") or addr.startswith("10.") or addr.startswith("172."):
                ips.add(addr)
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return sorted(ips) or ["127.0.0.1"]


def make_qr_base64(url):
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@app.route("/qr")
def qr_page():
    ips = get_local_ips()
    port = 5000
    selected_ip = request.args.get("ip", ips[0])
    base = f"http://{selected_ip}:{port}"
    pages = [
        {"label": "検品入力", "url": base + "/"},
        {"label": "集計", "url": base + "/summary"},
    ]
    for p in pages:
        p["qr"] = make_qr_base64(p["url"])
    return render_template("qr.html", pages=pages, base=base, ips=ips, selected_ip=selected_ip, port=port)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
