const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'src', 'index.ts'), 'utf8');

const marker = '// 修复 position_mappings 中 responsible_person 字段（可能是对象而非字符串）';
const count = src.split(marker).length - 1;
console.log('Found', count, 'occurrences of the fix endpoint');

if (count <= 1) {
  console.log('No duplicates found');
  process.exit(0);
}

// Keep only the FIRST occurrence, remove the rest
let result = src;
for (let i = 1; i < count; i++) {
  // Find the i-th occurrence
  let idx = result.indexOf(marker);
  for (let j = 0; j < i; j++) {
    idx = result.indexOf(marker, idx + 1);
  }
  // Find the end of this function (next "});" preceded by "}")
  const afterMarker = result.substring(idx);
  // Find the closing of this function
  let endIdx = -1;
  let searchFrom = 0;
  let depth = 0;
  for (let k = 0; k < afterMarker.length; k++) {
    if (afterMarker[k] === '{') depth++;
    else if (afterMarker[k] === '}') {
      depth--;
      if (depth === 0) {
        // Check if next chars are ");"
        if (afterMarker.substring(k+1, k+3) === ');') {
          endIdx = k + 3;
          break;
        }
      }
    }
  }
  
  if (endIdx > 0) {
    const toRemove = afterMarker.substring(0, endIdx);
    // Also remove the preceding newlines
    const beforeMarker = result.substring(0, idx);
    const cleanBefore = beforeMarker.replace(/\n+$/, '');
    result = cleanBefore + '\n' + result.substring(idx + toRemove.length);
    console.log('Removed duplicate #' + i);
  }
}

fs.writeFileSync(path.join(__dirname, '..', 'worker', 'src', 'index.ts'), result);
console.log('Done. File cleaned.');
