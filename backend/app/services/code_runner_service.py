import json
import os
import tempfile
import subprocess
import sys
from typing import Any, Dict, List


def _run_javascript(code: str, test_cases: List[Dict[str, Any]], time_limit_ms: int) -> Dict[str, Any]:
    harness = {
        "testCases": test_cases,
    }

    program = (
        "const payload = " + json.dumps(harness, ensure_ascii=False) + ";\n"
        + code
        + "\n"
        + "function __normalizeInput(input){\n"
        + "  if (input === undefined) return [];\n"
        + "  if (Array.isArray(input)) return input;\n"
        + "  return [input];\n"
        + "}\n"
        + "function __deepEqual(a,b){\n"
        + "  return JSON.stringify(a) === JSON.stringify(b);\n"
        + "}\n"
        + "const results = [];\n"
        + "let passedCount = 0;\n"
        + "for (let i=0;i<payload.testCases.length;i++){\n"
        + "  const tc = payload.testCases[i] || {};\n"
        + "  const args = __normalizeInput(tc.input);\n"
        + "  let ok = false;\n"
        + "  let actual = null;\n"
        + "  let error = null;\n"
        + "  try {\n"
        + "    if (typeof solution !== 'function') throw new Error('Missing function solution');\n"
        + "    actual = solution(...args);\n"
        + "    ok = __deepEqual(actual, tc.expected);\n"
        + "  } catch (e) {\n"
        + "    error = String(e && e.stack ? e.stack : e);\n"
        + "  }\n"
        + "  if (ok) passedCount++;\n"
        + "  results.push({index:i, ok, input: tc.input, expected: tc.expected, actual, error});\n"
        + "}\n"
        + "const out = {passed: passedCount === payload.testCases.length, score: payload.testCases.length ? Math.round((passedCount / payload.testCases.length) * 100) : 0, results};\n"
        + "console.log(JSON.stringify(out));\n"
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = os.path.join(tmpdir, "main.js")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(program)

        try:
            completed = subprocess.run(
                ["node", file_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=max(1, int(time_limit_ms / 1000)),
            )
        except subprocess.TimeoutExpired:
            return {"passed": False, "score": 0, "results": [], "error": "Time limit exceeded"}

        if completed.returncode != 0:
            return {
                "passed": False,
                "score": 0,
                "results": [],
                "error": completed.stderr.strip() or "Runtime error",
            }

        out = completed.stdout.strip().splitlines()[-1] if completed.stdout else ""
        try:
            return json.loads(out)
        except Exception:
            return {
                "passed": False,
                "score": 0,
                "results": [],
                "error": "Invalid runner output",
                "raw": out,
            }


def _run_python(code: str, test_cases: List[Dict[str, Any]], time_limit_ms: int) -> Dict[str, Any]:
    payload = {"testCases": test_cases}
    program = (
        "import json\n"
        "payload = json.loads(" + json.dumps(json.dumps(payload, ensure_ascii=False), ensure_ascii=False) + ")\n"
        + code
        + "\n"
        "def __normalize_input(x):\n"
        "    if x is None:\n"
        "        return []\n"
        "    if isinstance(x, list):\n"
        "        return x\n"
        "    return [x]\n"
        "def __deep_equal(a, b):\n"
        "    return json.dumps(a, ensure_ascii=False, sort_keys=True) == json.dumps(b, ensure_ascii=False, sort_keys=True)\n"
        "results = []\n"
        "passed_count = 0\n"
        "for i, tc in enumerate(payload.get('testCases', [])):\n"
        "    args = __normalize_input(tc.get('input'))\n"
        "    ok = False\n"
        "    actual = None\n"
        "    error = None\n"
        "    try:\n"
        "        if 'solution' not in globals() or not callable(globals().get('solution')):\n"
        "            raise Exception('Missing function solution')\n"
        "        actual = solution(*args)\n"
        "        ok = __deep_equal(actual, tc.get('expected'))\n"
        "    except Exception as e:\n"
        "        error = str(e)\n"
        "    if ok:\n"
        "        passed_count += 1\n"
        "    results.append({'index': i, 'ok': ok, 'input': tc.get('input'), 'expected': tc.get('expected'), 'actual': actual, 'error': error})\n"
        "total = len(payload.get('testCases', []))\n"
        "out = {'passed': passed_count == total, 'score': (round((passed_count / total) * 100) if total else 0), 'results': results}\n"
        "print(json.dumps(out, ensure_ascii=False))\n"
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = os.path.join(tmpdir, "main.py")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(program)

        try:
            completed = subprocess.run(
                [sys.executable, file_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=max(1, int(time_limit_ms / 1000)),
            )
        except subprocess.TimeoutExpired:
            return {"passed": False, "score": 0, "results": [], "error": "Time limit exceeded"}

        if completed.returncode != 0:
            return {
                "passed": False,
                "score": 0,
                "results": [],
                "error": completed.stderr.strip() or "Runtime error",
            }

        out = completed.stdout.strip().splitlines()[-1] if completed.stdout else ""
        try:
            return json.loads(out)
        except Exception:
            return {"passed": False, "score": 0, "results": [], "error": "Invalid runner output", "raw": out}


def _run_java(code: str, test_cases: List[Dict[str, Any]], time_limit_ms: int) -> Dict[str, Any]:
    payload = {"testCases": test_cases}
    payload_json = json.dumps(payload, ensure_ascii=False)
    runner = (
        "import java.util.*;\n"
        "public class Runner {\n"
        "  static class P {\n"
        "    final String s; int i=0;\n"
        "    P(String s){this.s=s;}\n"
        "    void ws(){while(i<s.length() && Character.isWhitespace(s.charAt(i))) i++;}\n"
        "    char ch(){return s.charAt(i);} \n"
        "    boolean has(){return i<s.length();}\n"
        "  }\n"
        "  static Object parse(String s){P p=new P(s); Object v=parseVal(p); p.ws(); return v;}\n"
        "  static Object parseVal(P p){p.ws(); if(!p.has()) return null; char c=p.ch();\n"
        "    if(c=='n'){p.i+=4; return null;}\n"
        "    if(c=='t'){p.i+=4; return Boolean.TRUE;}\n"
        "    if(c=='f'){p.i+=5; return Boolean.FALSE;}\n"
        "    if(c=='\"') return parseStr(p);\n"
        "    if(c=='[') return parseArr(p);\n"
        "    if(c=='{') return parseObj(p);\n"
        "    return parseNum(p);\n"
        "  }\n"
        "  static String parseStr(P p){StringBuilder sb=new StringBuilder(); p.i++; while(p.has()){char c=p.ch(); if(c=='\"'){p.i++; break;} if(c=='\\\\'){p.i++; char e=p.ch(); if(e=='\"'||e=='\\\\'||e=='/'){sb.append(e);} else if(e=='b'){sb.append('\\b');} else if(e=='f'){sb.append('\\f');} else if(e=='n'){sb.append('\\n');} else if(e=='r'){sb.append('\\r');} else if(e=='t'){sb.append('\\t');} else if(e=='u'){p.i++; int cp=Integer.parseInt(p.s.substring(p.i,p.i+4),16); sb.append((char)cp); p.i+=3;} p.i++; continue;} sb.append(c); p.i++;} return sb.toString();}\n"
        "  static Object parseNum(P p){int j=p.i; while(p.has()){char c=p.ch(); if((c>='0'&&c<='9')||c=='-'||c=='+'||c=='.'||c=='e'||c=='E'){p.i++;} else break;} String t=p.s.substring(j,p.i); if(t.indexOf('.')>=0||t.indexOf('e')>=0||t.indexOf('E')>=0) return Double.parseDouble(t); try{return Integer.parseInt(t);}catch(Exception e){return Long.parseLong(t);} }\n"
        "  static List<Object> parseArr(P p){List<Object> a=new ArrayList<>(); p.i++; p.ws(); if(p.has()&&p.ch()==']'){p.i++; return a;} while(true){Object v=parseVal(p); a.add(v); p.ws(); if(!p.has()) break; char c=p.ch(); if(c==','){p.i++; continue;} if(c==']'){p.i++; break;} }\n"
        "    return a;}\n"
        "  static Map<String,Object> parseObj(P p){Map<String,Object> m=new LinkedHashMap<>(); p.i++; p.ws(); if(p.has()&&p.ch()=='}'){p.i++; return m;} while(true){p.ws(); String k=parseStr(p); p.ws(); p.i++; Object v=parseVal(p); m.put(k,v); p.ws(); if(!p.has()) break; char c=p.ch(); if(c==','){p.i++; continue;} if(c=='}'){p.i++; break;} }\n"
        "    return m;}\n"
        "  static String toJson(Object v){ if(v==null) return \"null\"; if(v instanceof String) return \"\\\"\"+esc((String)v)+\"\\\"\"; if(v instanceof Boolean) return ((Boolean)v)?\"true\":\"false\"; if(v instanceof Number) return v.toString();\n"
        "    if(v instanceof Map){StringBuilder sb=new StringBuilder(); sb.append('{'); boolean first=true; for(Object ek:((Map)v).keySet()){if(!first) sb.append(','); first=false; sb.append(\"\\\"\").append(esc(String.valueOf(ek))).append(\"\\\":\"); sb.append(toJson(((Map)v).get(ek)));} sb.append('}'); return sb.toString();}\n"
        "    if(v instanceof List){StringBuilder sb=new StringBuilder(); sb.append('['); boolean first=true; for(Object it:(List)v){if(!first) sb.append(','); first=false; sb.append(toJson(it));} sb.append(']'); return sb.toString();}\n"
        "    if(v.getClass().isArray()){int n=java.lang.reflect.Array.getLength(v); StringBuilder sb=new StringBuilder(); sb.append('['); for(int i=0;i<n;i++){if(i>0) sb.append(','); sb.append(toJson(java.lang.reflect.Array.get(v,i)));} sb.append(']'); return sb.toString();}\n"
        "    return \"\\\"\"+esc(String.valueOf(v))+\"\\\"\"; }\n"
        "  static String esc(String s){StringBuilder sb=new StringBuilder(); for(int i=0;i<s.length();i++){char c=s.charAt(i); switch(c){case '\"': sb.append(\"\\\\\\\"\"); break; case '\\\\': sb.append(\"\\\\\\\\\"); break; case '\\n': sb.append(\"\\\\n\"); break; case '\\r': sb.append(\"\\\\r\"); break; case '\\t': sb.append(\"\\\\t\"); break; default: sb.append(c);} } return sb.toString(); }\n"
        "  static List<Object> norm(Object in){ if(in==null) return new ArrayList<>(); if(in instanceof List) return (List<Object>)in; List<Object> a=new ArrayList<>(); a.add(in); return a; }\n"
        "  public static void main(String[] args) throws Exception {\n"
        "    String payload = " + json.dumps(payload_json) + ";\n"
        "    Object root = parse(payload);\n"
        "    Map m = (Map)root;\n"
        "    List tcs = (List)m.get(\"testCases\");\n"
        "    List results = new ArrayList();\n"
        "    int passed = 0;\n"
        "    for(int i=0;i<tcs.size();i++){\n"
        "      Map tc=(Map)tcs.get(i);\n"
        "      Object input=tc.get(\"input\");\n"
        "      Object expected=tc.get(\"expected\");\n"
        "      List a = norm(input);\n"
        "      boolean ok=false;\n"
        "      Object actual=null;\n"
        "      String error=null;\n"
        "      try{\n"
        "        java.lang.reflect.Method mm = Solution.class.getMethod(\"solution\", Object[].class);\n"
        "        actual = mm.invoke(null, new Object[]{ a.toArray(new Object[0]) });\n"
        "        ok = toJson(actual).equals(toJson(expected));\n"
        "      }catch(Throwable e){\n"
        "        error = String.valueOf(e);\n"
        "      }\n"
        "      if(ok) passed++;\n"
        "      Map rr=new LinkedHashMap();\n"
        "      rr.put(\"index\", i);\n"
        "      rr.put(\"ok\", ok);\n"
        "      rr.put(\"input\", input);\n"
        "      rr.put(\"expected\", expected);\n"
        "      rr.put(\"actual\", actual);\n"
        "      rr.put(\"error\", error);\n"
        "      results.add(rr);\n"
        "    }\n"
        "    int total = tcs.size();\n"
        "    Map out = new LinkedHashMap();\n"
        "    out.put(\"passed\", passed==total);\n"
        "    out.put(\"score\", total==0 ? 0 : (int)Math.round((passed*100.0)/total));\n"
        "    out.put(\"results\", results);\n"
        "    System.out.println(toJson(out));\n"
        "  }\n"
        "}\n"
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        sol_path = os.path.join(tmpdir, "Solution.java")
        run_path = os.path.join(tmpdir, "Runner.java")
        with open(sol_path, "w", encoding="utf-8") as f:
            f.write(code)
        with open(run_path, "w", encoding="utf-8") as f:
            f.write(runner)

        try:
            compiled = subprocess.run(
                ["javac", "Runner.java", "Solution.java"],
                cwd=tmpdir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=max(1, int(time_limit_ms / 1000)),
            )
        except subprocess.TimeoutExpired:
            return {"passed": False, "score": 0, "results": [], "error": "Time limit exceeded"}

        if compiled.returncode != 0:
            return {"passed": False, "score": 0, "results": [], "error": compiled.stderr.strip() or "Compile error"}

        try:
            completed = subprocess.run(
                ["java", "-cp", tmpdir, "Runner"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=max(1, int(time_limit_ms / 1000)),
            )
        except subprocess.TimeoutExpired:
            return {"passed": False, "score": 0, "results": [], "error": "Time limit exceeded"}

        if completed.returncode != 0:
            return {"passed": False, "score": 0, "results": [], "error": completed.stderr.strip() or "Runtime error"}

        out = completed.stdout.strip().splitlines()[-1] if completed.stdout else ""
        try:
            return json.loads(out)
        except Exception:
            return {"passed": False, "score": 0, "results": [], "error": "Invalid runner output", "raw": out}


def run_code_against_tests(language: str, code: str, test_cases: List[Dict[str, Any]], time_limit_ms: int = 3000) -> Dict[str, Any]:
    lang = (language or "javascript").lower()
    if lang in ["javascript", "js"]:
        return _run_javascript(code=code, test_cases=test_cases, time_limit_ms=time_limit_ms)
    if lang in ["python", "py"]:
        return _run_python(code=code, test_cases=test_cases, time_limit_ms=time_limit_ms)
    if lang in ["java"]:
        return _run_java(code=code, test_cases=test_cases, time_limit_ms=time_limit_ms)
    return {"passed": False, "score": 0, "results": [], "error": "Unsupported language"}
