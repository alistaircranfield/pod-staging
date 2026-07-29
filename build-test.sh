#!/bin/sh
# Regenerate the test copy from index.html. Run this after EVERY change to index.html,
# or the sandbox quietly drifts behind the live site and stops being a fair test.
set -e
cd "$(dirname "$0")"
sed -e 's|<title>CCU Pod Allocator</title>|<title>CCU Pod Allocator — TEST</title>|' \
    -e 's|<script src="k.js"></script>|<script>window.__POD_TEST = true;</script>\n<script src="k.js"></script>|' \
    index.html > test.html
grep -q '__POD_TEST' test.html || { echo "FAILED: test flag not inserted"; exit 1; }
grep -q 'TEST</title>' test.html || { echo "FAILED: title not changed"; exit 1; }
echo "test.html rebuilt from index.html ($(wc -c < test.html) bytes)"
