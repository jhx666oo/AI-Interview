"""Debug: find what's at the error location in the bundle."""
import re, sys

with open(sys.argv[1], 'rb') as f:
    c = f.read().decode('utf-8', errors='replace')

lines = c.split('\n')
line7 = lines[6]  # 0-indexed line 7

print(f'File: {sys.argv[1]}')
print(f'Line 7 length: {len(line7)}')
print()

start = max(0, int(sys.argv[2]) - 150)
end = min(len(line7), int(sys.argv[2]) + 300)
chunk = line7[start:end]
print(f'Context around position {sys.argv[2]}:')
print(chunk)
print()

# Find all .length calls and their context
print('All .length calls in this line:')
for m in re.finditer(r'\.length', line7):
    before = line7[max(0,m.start()-60):m.start()]
    print(f'  pos {m.start()}: ...{before}.length')
print()

# Find the function containing position 25363
# Search for function declarations around the position
fn_matches = list(re.finditer(r'[$a-zA-Z_][\w$]*\(', line7))
for fn in fn_matches:
    if abs(fn.start() - int(sys.argv[2])) < 500:
        print(f'  Nearby function: {fn.group()} at pos {fn.start()}')
