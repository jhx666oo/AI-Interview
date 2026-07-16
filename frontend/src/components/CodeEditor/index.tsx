import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { oneDark } from '@codemirror/theme-one-dark';

type Language = 'javascript' | 'python' | 'java';

type Props = {
  value?: string;
  onChange?: (value: string) => void;
  language?: Language | string;
  height?: number | string;
  readOnly?: boolean;
};

const getExtensions = (language?: string) => {
  const lang = (language || 'javascript').toLowerCase();
  if (lang === 'python' || lang === 'py') return [python()];
  if (lang === 'java') return [java()];
  return [javascript({ typescript: false, jsx: false })];
};

const CodeEditor: React.FC<Props> = ({ value, onChange, language, height = 360, readOnly }) => {
  return (
    <CodeMirror
      value={value || ''}
      height={typeof height === 'number' ? `${height}px` : height}
      theme={oneDark}
      editable={!readOnly}
      extensions={getExtensions(language)}
      basicSetup={{
        foldGutter: true,
        lineNumbers: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
      }}
      onChange={(v) => onChange?.(v)}
    />
  );
};

export default CodeEditor;
