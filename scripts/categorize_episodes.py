#!/usr/bin/env python3
"""
One-time script to:
1. Apply schema migrations (new columns + category_rules table)
2. Categorize all episodes using regex rules
3. Link cross-feed duplicates (Ad Free <-> Episode)
4. Delete stale local test records
"""

import sqlite3
import re
import os
from collections import defaultdict

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'ice_cream_social.db')

# Category rules (same as seeded in Rust init_schema)
RULES = [
    # (priority, category, display_name, title_pattern, number_pattern)
    (1, 'fubts', 'FUBTS', r'(?i)P?&?T?\s*FUBTS', r'(?i)FUBTS\s*([\d.]+)'),
    (2, 'scoopflix', 'Scoopflix', r'(?i)scoopfl?i?x|Not Furlong', None),
    (3, 'abracababble', 'Abracababble', r'(?i)abracababble', r'(?i)abracababble\s*(\d+)'),
    (4, 'shituational', 'Shituational', r'(?i)shituational\s*aware', r'(\d+)'),
    (5, 'episode', 'Episode', r'(?i)^(Episode|Ad Free)\s+\d+', r'(?i)(?:Episode|Ad Free)\s+(\d+)'),
    (99, 'bonus', 'Bonus', r'.', None),
]

def extract_scoopflix_sub_series(title):
    if re.search(r'(?i)not\s+furlong', title):
        return 'Not Furlong'
    m = re.search(r'(?i)scoopfl?i?x\s*(?:and Chill)?[:\s]+(.+?)(?:\s*[-–]\s*Episode|\s*\d+\s*$|\s*$)', title)
    if m:
        show_name = m.group(1).strip()
        if len(show_name) > 1:
            return show_name
    return None

def categorize_episode(title):
    for priority, category, display_name, title_pattern, number_pattern in RULES:
        if priority == 99:
            continue
        if re.search(title_pattern, title):
            category_number = None
            episode_number = None
            sub_series = None

            if number_pattern:
                m = re.search(number_pattern, title)
                if m:
                    category_number = m.group(1)

            if category == 'episode':
                episode_number = category_number

            if category == 'scoopflix':
                sub_series = extract_scoopflix_sub_series(title)

            return category, episode_number, category_number, sub_series

    # Fallback: bonus
    # Still try to extract episode number
    ep_num = None
    for pattern in [r'(?i)(?:Episode|Ad Free)\s+(\d+)', r'#(\d+)', r'(?i)Ep\.?\s*(\d+)']:
        m = re.search(pattern, title)
        if m:
            ep_num = m.group(1)
            break
    return 'bonus', ep_num, None, None

def main():
    print(f"Opening database: {os.path.abspath(DB_PATH)}")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")

    # Step 1: Schema migrations (idempotent)
    print("\n=== Step 1: Schema Migrations ===")
    migrations = [
        "ALTER TABLE episodes ADD COLUMN category TEXT DEFAULT 'episode'",
        "ALTER TABLE episodes ADD COLUMN category_number TEXT",
        "ALTER TABLE episodes ADD COLUMN sub_series TEXT",
        "ALTER TABLE episodes ADD COLUMN canonical_id INTEGER REFERENCES episodes(id)",
    ]
    for sql in migrations:
        try:
            conn.execute(sql)
            col_name = sql.split("ADD COLUMN ")[1].split()[0]
            print(f"  Added column: {col_name}")
        except sqlite3.OperationalError as e:
            if "duplicate column" in str(e).lower():
                pass  # Already exists
            else:
                print(f"  Warning: {e}")

    conn.execute("CREATE INDEX IF NOT EXISTS idx_episodes_category ON episodes(category)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_episodes_canonical ON episodes(canonical_id)")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS category_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            title_pattern TEXT NOT NULL,
            number_pattern TEXT,
            priority INTEGER DEFAULT 0,
            icon TEXT,
            color TEXT
        )
    """)

    seed_rules = [
        ('fubts', 'FUBTS', r'(?i)P?&?T?\s*FUBTS', r'(?i)FUBTS\s*([\d.]+)', 1, '🎭', '#ef4444'),
        ('scoopflix', 'Scoopflix', r'(?i)scoopfl?i?x|Not Furlong', None, 2, '🎬', '#f59e0b'),
        ('abracababble', 'Abracababble', r'(?i)abracababble', r'(?i)abracababble\s*(\d+)', 3, '🔮', '#8b5cf6'),
        ('shituational', 'Shituational', r'(?i)shituational\s*aware', r'(\d+)', 4, '💩', '#a3e635'),
        ('episode', 'Episode', r'(?i)^(Episode|Ad Free)\s+\d+', r'(?i)(?:Episode|Ad Free)\s+(\d+)', 5, '🎙️', '#6366f1'),
        ('bonus', 'Bonus', r'.', None, 99, '🎁', '#6b7280'),
    ]
    for cat, display, pattern, num_pattern, priority, icon, color in seed_rules:
        conn.execute(
            "INSERT OR IGNORE INTO category_rules (category, display_name, title_pattern, number_pattern, priority, icon, color) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (cat, display, pattern, num_pattern, priority, icon, color)
        )
    conn.commit()
    print("  Schema migrations complete.")

    # Step 2: Categorize all episodes
    print("\n=== Step 2: Categorize All Episodes ===")
    episodes = conn.execute("SELECT id, title, feed_source FROM episodes").fetchall()
    counts = defaultdict(int)

    for ep_id, title, feed_source in episodes:
        cat, ep_num, cat_num, sub_series = categorize_episode(title)
        conn.execute(
            "UPDATE episodes SET category = ?, episode_number = COALESCE(?, episode_number), category_number = ?, sub_series = ? WHERE id = ?",
            (cat, ep_num, cat_num, sub_series, ep_id)
        )
        counts[cat] += 1

    conn.commit()
    print(f"  Categorized {len(episodes)} episodes:")
    for cat, count in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"    {cat}: {count}")

    # Step 3: Link cross-feed duplicates
    print("\n=== Step 3: Link Cross-Feed Duplicates ===")
    episode_rows = conn.execute(
        "SELECT id, category_number, feed_source FROM episodes WHERE category = 'episode' AND category_number IS NOT NULL"
    ).fetchall()

    by_number = defaultdict(list)
    for ep_id, cat_num, feed_source in episode_rows:
        by_number[cat_num].append((ep_id, feed_source))

    linked = 0
    for num, eps in by_number.items():
        if len(eps) < 2:
            continue
        apple = [e for e in eps if e[1] == 'apple']
        patreon = [e for e in eps if e[1] == 'patreon']
        if apple and patreon:
            canonical_id = apple[0][0]
            for variant_id, _ in patreon:
                # Check if already linked
                existing = conn.execute(
                    "SELECT canonical_id FROM episodes WHERE id = ?", (variant_id,)
                ).fetchone()
                if existing and existing[0] is None:
                    conn.execute(
                        "UPDATE episodes SET canonical_id = ? WHERE id = ?",
                        (canonical_id, variant_id)
                    )
                    linked += 1

    conn.commit()
    dupe_numbers = sum(1 for eps in by_number.values() if len(eps) >= 2)
    print(f"  Linked {linked} patreon variants to apple canonical episodes")
    print(f"  Episode numbers with cross-feed duplicates: {dupe_numbers}")

    # Step 4: Delete stale local test records
    print("\n=== Step 4: Cleanup ===")
    cursor = conn.execute("DELETE FROM episodes WHERE feed_source = 'local'")
    deleted = cursor.rowcount
    conn.commit()
    print(f"  Deleted {deleted} stale local test record(s)")

    # Step 5: Verification
    print("\n=== Verification ===")
    for cat, count in conn.execute("SELECT category, COUNT(*) FROM episodes GROUP BY category ORDER BY COUNT(*) DESC").fetchall():
        print(f"  {cat}: {count}")

    canonical_count = conn.execute("SELECT COUNT(*) FROM episodes WHERE canonical_id IS NOT NULL").fetchone()[0]
    visible_count = conn.execute("SELECT COUNT(*) FROM episodes WHERE canonical_id IS NULL").fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM episodes").fetchone()[0]
    print(f"\n  Total episodes: {total}")
    print(f"  Visible (canonical_id IS NULL): {visible_count}")
    print(f"  Hidden variants (canonical_id set): {canonical_count}")

    # Show some edge case examples
    print("\n=== Edge Case Samples ===")
    for cat in ['fubts', 'scoopflix', 'abracababble', 'shituational', 'bonus']:
        rows = conn.execute(
            "SELECT title, category_number, sub_series FROM episodes WHERE category = ? LIMIT 3", (cat,)
        ).fetchall()
        if rows:
            print(f"\n  {cat}:")
            for title, cat_num, sub in rows:
                extra = f" [#{cat_num}]" if cat_num else ""
                extra += f" ({sub})" if sub else ""
                print(f"    - {title[:80]}{extra}")

    conn.close()
    print("\nDone!")

if __name__ == '__main__':
    main()
