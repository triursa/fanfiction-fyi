#!/usr/bin/env python3
"""
Codemod: Convert raw SQL call sites to Drizzle ORM in fanfiction-fyi.

This is a HEURISTIC converter. It handles the most common patterns but may
miss edge cases. Always review the output.

Patterns handled:
- queryFirst<T>(db, `SELECT ... FROM table WHERE col = ?1`, val) → db.select().from(table).where(eq(table.col, val)).get()
- queryAll<T>(db, `SELECT ... FROM table WHERE col = ?1`, val) → db.select().from(table).where(eq(table.col, val))
- queryAll<T>(db, `SELECT ... FROM table ORDER BY col`) → db.select().from(table).orderBy(table.col)
- run(db, `INSERT INTO table (...) VALUES (?, ...)`, vals) → db.insert(table).values({...})
- run(db, `DELETE FROM table WHERE col = ?1`, val) → db.delete(table).where(eq(table.col, val))
- run(db, `UPDATE table SET col = ?1 WHERE id = ?2`, val, id) → db.update(table).set({...}).where(eq(table.id, id))
- db.prepare(sql).bind(...params).first() → db.select().from(table).where(...).get()
"""
import re
import os
import sys

# Schema table name → Drizzle import name mapping
TABLE_MAP = {
    'users': 'users',
    'sessions': 'sessions',
    'pseuds': 'pseuds',
    'works': 'works',
    'chapters': 'chapters',
    'chapter_versions': 'chapterVersions',
    'creatorships': 'creatorships',
    'readings': 'readings',
    'tags': 'tags',
    'taggings': 'taggings',
    'collections': 'collections',
    'collection_items': 'collectionItems',
    'comments': 'comments',
    'kudos': 'kudos',
    'bookmarks': 'bookmarks',
    'series': 'series',
    'serial_works': 'serialWorks',
    'invite_codes': 'inviteCodes',
    'oauth_states': 'oauthStates',
    'rate_limits': 'rateLimits',
    'characters': 'characters',
    'character_groups': 'characterGroups',
    'character_appearances': 'characterAppearances',
    'chapter_reactions': 'chapterReactions',
    'work_relations': 'workRelations',
    'lore_entries': 'loreEntries',
    'locations': 'locations',
    'entity_references': 'entityReferences',
    'lore_edits': 'loreEdits',
    'location_edits': 'locationEdits',
}

# This is a diagnostic tool — it lists all the SQL patterns found but doesn't modify files.
# The actual conversion is too complex for pure regex; it needs AST-level understanding.

def analyze_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    issues = []
    
    # Find queryFirst calls
    for m in re.finditer(r'queryFirst<([^>]+)>\(\s*db\s*,\s*`([^`]+)`\s*(?:,\s*(.+))?\)', content):
        type_arg, sql, params = m.group(1), m.group(2), m.group(3)
        issues.append(('queryFirst', sql.strip(), params.strip() if params else '', type_arg))
    
    # Find queryAll calls
    for m in re.finditer(r'queryAll<([^>]+)>\(\s*db\s*,\s*`([^`]+)`\s*(?:,\s*(.+))?\)', content):
        type_arg, sql, params = m.group(1), m.group(2), m.group(3)
        issues.append(('queryAll', sql.strip(), params.strip() if params else '', type_arg))
    
    # Find run calls
    for m in re.finditer(r'(?<!\w)run\(\s*db\s*,\s*`([^`]+)`\s*(?:,\s*(.+))?\)', content):
        sql, params = m.group(1), m.group(2)
        issues.append(('run', sql.strip(), params.strip() if params else '', ''))
    
    # Find db.prepare calls
    for m in re.finditer(r'db\.prepare\(\s*`([^`]+)`\s*\)', content):
        sql = m.group(1).strip()
        issues.append(('db.prepare', sql, '', ''))
    
    return issues


def main():
    src_dir = '/Volumes/4TB/Repositories/fanfiction-fyi/src'
    
    # Find all files with legacy patterns
    all_issues = {}
    for root, dirs, files in os.walk(src_dir):
        # Skip schema dir
        if '/lib/schema' in root:
            continue
        for fname in files:
            if not fname.endswith(('.ts', '.astro')):
                continue
            fpath = os.path.join(root, fname)
            issues = analyze_file(fpath)
            if issues:
                all_issues[fpath] = issues
    
    total = sum(len(v) for v in all_issues.values())
    print(f"Found {total} legacy SQL calls across {len(all_issues)} files\n")
    
    for fpath, issues in sorted(all_issues.items()):
        rel = fpath.replace(src_dir + '/', '')
        print(f"\n{rel} ({len(issues)} calls):")
        for kind, sql, params, type_arg in issues:
            # Extract table name from SQL
            sql_lower = sql.lower()
            table_name = None
            if 'from' in sql_lower:
                from_match = re.search(r'from\s+(\w+)', sql_lower)
                if from_match:
                    table_name = from_match.group(1)
            elif 'insert into' in sql_lower:
                ins_match = re.search(r'insert\s+into\s+(\w+)', sql_lower)
                if ins_match:
                    table_name = ins_match.group(1)
            elif 'update' in sql_lower:
                upd_match = re.search(r'update\s+(\w+)', sql_lower)
                if upd_match:
                    table_name = upd_match.group(1)
            elif 'delete from' in sql_lower:
                del_match = re.search(r'delete\s+from\s+(\w+)', sql_lower)
                if del_match:
                    table_name = del_match.group(1)
            
            drizzle_table = TABLE_MAP.get(table_name, table_name) if table_name else '?'
            print(f"  {kind}: table={drizzle_table}, sql='''{sql[:80]}'''")
    
    # Summary of tables involved
    table_counts = {}
    for issues in all_issues.values():
        for kind, sql, params, type_arg in issues:
            sql_lower = sql.lower()
            table_name = None
            if 'from' in sql_lower:
                from_match = re.search(r'from\s+(\w+)', sql_lower)
                if from_match:
                    table_name = from_match.group(1)
            elif 'insert into' in sql_lower:
                ins_match = re.search(r'insert\s+into\s+(\w+)', sql_lower)
                if ins_match:
                    table_name = ins_match.group(1)
            elif 'update' in sql_lower:
                upd_match = re.search(r'update\s+(\w+)', sql_lower)
                if upd_match:
                    table_name = upd_match.group(1)
            elif 'delete from' in sql_lower:
                del_match = re.search(r'delete\s+from\s+(\w+)', sql_lower)
                if del_match:
                    table_name = del_match.group(1)
            
            if table_name:
                table_counts[table_name] = table_counts.get(table_name, 0) + 1
    
    print(f"\n\n=== TABLE USAGE SUMMARY ===")
    for t, c in sorted(table_counts.items(), key=lambda x: -x[1]):
        drizzle_name = TABLE_MAP.get(t, t)
        print(f"  {t} → {drizzle_name}: {c} queries")


if __name__ == '__main__':
    main()