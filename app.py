# -*- coding: utf-8 -*-
"""
文渊阁 - 后端服务
功能模块：时政热点 / 汉字查询 / 词语成语 / 情景默写 / 文言实词虚词
"""

import json
import os
import re
import time
import hashlib
import threading
import random
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, render_template, request

# ============================================================
# 延迟导入：requests/bs4 仅联网查询时需要（加速启动）
# ============================================================
class _LazyModule:
    def __init__(self, loader):
        self._loader = loader
        self._mod = None
    def __getattr__(self, attr):
        if self._mod is None:
            self._mod = self._loader()
        return getattr(self._mod, attr)

requests = _LazyModule(lambda: __import__("requests"))

def _lazy_beautifulsoup(*args, **kwargs):
    global BeautifulSoup
    from bs4 import BeautifulSoup as _BS
    BeautifulSoup = _BS
    return _BS(*args, **kwargs)
BeautifulSoup = _lazy_beautifulsoup

app = Flask(__name__, template_folder="templates", static_folder="static")

# ============================================================
# 路径与全局缓存
# ============================================================
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "static" / "data"


# ============================================================
# 数据加载
# ============================================================
def load_json(filename):
    """加载JSON数据文件"""
    filepath = DATA_DIR / filename
    if not filepath.exists():
        return []
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)

# 预加载数据
WORDS_IDIOMS_DATA = load_json("words_idioms.json")
DICTATION_DATA = load_json("dictation.json")
CLASSICAL_WORDS_DATA = load_json("classical_words.json")
SENTENCE_ERRORS_DATA = load_json("sentence_errors.json")
TYPO_QUESTIONS_DATA = load_json("typo_questions.json")

# 文言词条快速索引（汉字 -> 词条，用于汉字查询的文言语义）
CLASSICAL_LOOKUP = {d["word"]: d for d in CLASSICAL_WORDS_DATA if d.get("word")}

# 构建搜索索引
def build_search_index(items, fields):
    """为数据项构建搜索索引"""
    index = []
    for item in items:
        text = " ".join(str(item.get(f, "")) for f in fields).lower()
        index.append({"item": item, "text": text})
    return index

WORDS_IDIOMS_INDEX = build_search_index(WORDS_IDIOMS_DATA, ["word", "pinyin", "meaning", "context", "type", "sentiment"])

# ============================================================
# 模块二：汉字查询
# ============================================================
def parse_definition_text(raw_text):
    """将原始释义文本解析为结构化的释义条目列表。"""
    if not raw_text:
        return []

    entries = []
    pos_splits = re.split(r'[\[\u3010]([名动形副介连助叹量代数拟声])[\]\u3011]', raw_text)

    if len(pos_splits) > 1:
        current_pos = None
        for i, part in enumerate(pos_splits):
            part = part.strip()
            if not part:
                continue
            if i % 2 == 1:
                current_pos = part
            else:
                sub_entries = split_numbered_entries(part)
                for num, text in sub_entries:
                    entries.append({"type": current_pos or "", "number": num, "text": text.strip()})
                if not sub_entries and part:
                    entries.append({"type": current_pos or "", "number": "", "text": part})
    else:
        sub_entries = split_numbered_entries(raw_text)
        for num, text in sub_entries:
            entries.append({"type": "", "number": num, "text": text.strip()})
        if not sub_entries and raw_text.strip():
            entries.append({"type": "", "number": "", "text": raw_text.strip()})

    return entries

def split_numbered_entries(text):
    """将文本按编号符号分割。"""
    entries = []

    circled = re.split(r'([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮])', text)
    if len(circled) > 1:
        current_num = ""
        current_text = ""
        for part in circled:
            part = part.strip()
            if not part:
                continue
            if re.match(r'^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]$', part):
                if current_text:
                    entries.append((current_num, current_text))
                current_num = part
                current_text = ""
            else:
                current_text += part
        if current_text:
            entries.append((current_num, current_text))
        return entries

    numbered = re.split(r'(\d+[.、])', text)
    if len(numbered) > 1:
        current_num = ""
        current_text = ""
        for part in numbered:
            part = part.strip()
            if not part:
                continue
            if re.match(r'^\d+[.、]$', part):
                if current_text:
                    entries.append((current_num, current_text))
                current_num = part.rstrip('.、')
                current_text = ""
            else:
                current_text += part
        if current_text:
            entries.append((current_num, current_text))
        return entries

    sentences = re.split(r'[。；;]\s*', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    if len(sentences) > 1:
        for i, s in enumerate(sentences, 1):
            entries.append((str(i), s))
        return entries

    return [("", text.strip())]

# ============================================================
# 汉字查询：区分现代文释义 / 文言文释义
# ============================================================
_POS_MAP = {
    "名": "名词", "动": "动词", "形": "形容词", "副": "副词",
    "量": "量词", "代": "代词", "介": "介词", "连": "连词",
    "助": "助词", "叹": "叹词", "数": "数词", "拟": "拟声词",
}


def _split_source_tail(segment):
    """把 '《出处》注:“...”后续句子' 拆成 (出处, 后续句子)"""
    idx = segment.rfind("》")
    if idx == -1:
        return segment, ""
    head = segment[:idx + 1]
    rest = segment[idx + 1:]
    m = re.match(r'^((?:司农|郑玄|颜师古|孔颖达)?注[:：][^”"]*[”"]|[（(][^）)]*[）)])', rest)
    if m:
        return head + m.group(1), rest[m.end():]
    return head, rest


def _parse_citations(text):
    """解析汉典书证文本 -> [{sentence, source}]，格式：句子——《出处》句子——《出处》..."""
    if not text:
        return []
    text = re.sub(r"^书证\s*", "", text.strip())
    parts = [p.strip() for p in re.split(r"——", text) if p.strip()]
    if not parts:
        return []
    sentences = [parts[0]]
    sources = []
    for seg in parts[1:]:
        src, tail = _split_source_tail(seg)
        sources.append(src)
        if tail:
            sentences.append(tail)
    examples = []
    for i, s in enumerate(sentences):
        src = sources[i] if i < len(sources) else (sources[-1] if sources else "")
        if s and src:
            examples.append({"sentence": s, "source": src})
    return examples


def _extract_benji(etymology_text):
    """从词源说明中提取本义，如 '(会意。...本义:兵器，武器)' -> '兵器，武器'"""
    m = re.search(r"本义[:：]\s*([^)）]+)", etymology_text or "")
    return m.group(1).strip().rstrip("。；;") if m else ''


def _clean_def_text(text):
    """去掉英文注释 [run]、词源括号与 '。如:...' 例注"""
    text = re.sub(r"\[[^\]]*\]", "", text or "")
    text = re.sub(r"^\([^)]*\)\s*", "", text)
    text = re.split(r"[。；;]\s*如[:：]", text)[0]
    return text.strip()


def _extract_pos(text):
    """从词性块开头提取词性，如 '动(会意。...' -> '动词'"""
    text = (text or "").strip()
    for k, v in _POS_MAP.items():
        if text.startswith(k):
            return v
    return ""


def query_character(char):
    """查询汉字信息 - 区分现代文释义与文言文释义，文言义附具体例句"""
    if not char or len(char) != 1:
        return {"success": False, "error": "请输入单个汉字"}

    result = {"success": True, "character": char}

    try:
        cp = ord(char)
        result["unicode"] = f"U+{cp:04X}"
        result["unicode_dec"] = cp
    except Exception:
        pass

    modern = []       # 现代文释义 [{number, text, examples}]
    classical = []    # 文言文释义 [{meaning, usage, examples:[{sentence, source, translation?}]}]
    citation_pool = []  # 全页书证（兜底用）

    try:
        url = f"https://www.zdic.net/hans/{char}"
        resp = requests.get(url, timeout=12, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        })
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")

            pinyin_elem = soup.find(class_="meta-pinyin")
            if pinyin_elem:
                result["pinyin"] = pinyin_elem.get_text(strip=True)

            zhuyin_elem = soup.find(class_="meta-zhuyin")
            if zhuyin_elem:
                result["zhuyin"] = zhuyin_elem.get_text(strip=True)

            for row in soup.find_all(class_="meta-row"):
                row_text = row.get_text(strip=True)
                if "radical" not in result:
                    m = re.search(r'部首(.+?)部外', row_text)
                    if m:
                        result["radical"] = m.group(1).strip()
                if "strokes" not in result:
                    m = re.search(r'总笔画(\d+)', row_text)
                    if m:
                        result["strokes"] = m.group(1)
                if "structure" not in result:
                    m = re.search(r'字形结构(.+?)(?:字形分析|$)', row_text)
                    if m:
                        result["structure"] = m.group(1).strip()
                if "wubi" not in result:
                    m = re.search(r'五笔([a-z]+)', row_text, re.IGNORECASE)
                    if m:
                        result["wubi"] = m.group(1).strip()

            # ---------- 按释义区分块解析（只取 sense-group 内的条目）----------
            benji = ""
            for sg in soup.find_all(class_="sense-group"):
                sense_type = sg.get("data-sense-type", "")

                if sense_type == "xxjs":
                    # 详细解释：带书证 -> 文言义，无书证 -> 现代义
                    for pos_sec in sg.find_all(class_="xxjs-pos-section"):
                        head = pos_sec.find(class_="xxjs-pos-section__head")
                        usage = _extract_pos(head.get_text(strip=True) if head else "")

                        for item in pos_sec.find_all(class_="xxjs-item"):
                            def_elem = item.find(class_="xxjs-item__def")
                            if not def_elem:
                                continue
                            raw_def = def_elem.get_text(strip=True)
                            cit_elem = item.find(class_="xxjs-citation")
                            citations = _parse_citations(cit_elem.get_text(strip=True)) if cit_elem else []
                            citation_pool.extend(citations)

                            # 词源说明行：提取本义后跳过
                            if raw_def.startswith("(") and "本义" in raw_def:
                                benji = _extract_benji(raw_def) or benji
                                continue

                            def_text = _clean_def_text(raw_def)
                            if not def_text or def_text in ("同本义",):
                                def_text = benji
                            if not def_text:
                                continue

                            if citations:
                                classical.append({
                                    "meaning": def_text,
                                    "usage": usage,
                                    "examples": citations[:3],   # 每个义项最多 3 条书证
                                })
                            else:
                                modern.append({"number": "", "text": def_text, "examples": []})

                elif sense_type == "jbjs":
                    # 基本解释：默认现代义；标注"古代/古指" -> 文言义
                    for item in sg.find_all(class_="jbjs-item"):
                        def_elem = item.find(class_="jbjs-item__def")
                        if not def_elem:
                            continue
                        def_text = def_elem.get_text(strip=True)
                        eg_elem = item.find(class_="jbjs-item__eg")
                        eg_text = eg_elem.get_text(strip=True) if eg_elem else ""

                        is_classical = bool(re.search(r"古代指|古时指|古指|〈文言〉|〈书〉", def_text))
                        clean = re.sub(r"古代指|古时指|古指|〈文言〉|〈书〉", "", def_text).strip()

                        if is_classical:
                            classical.append({
                                "meaning": clean.rstrip("。"),
                                "usage": "",
                                "examples": citation_pool[:1] if citation_pool else [],
                            })
                        else:
                            modern.append({"number": "", "text": def_text, "examples": [eg_text] if eg_text else []})

                elif sense_type == "guoyu":
                    # 国语辞典：补充书证池
                    for cit in sg.find_all(class_="gy-sense__cit"):
                        citation_pool.extend(_parse_citations(cit.get_text(strip=True)))

    except Exception as e:
        print(f"[Character] zdic.net 查询失败: {e}")

    # ---------- 现代义兜底：dict.cn ----------
    if not modern:
        try:
            url = f"https://apii.dict.cn/mini.php?q={char}"
            resp = requests.get(url, timeout=10, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                for ol in soup.find_all("ol"):
                    for i, li in enumerate(ol.find_all("li")):
                        text = li.get_text(strip=True)
                        if text and len(text) > 2:
                            modern.append({"number": str(i + 1), "text": text, "examples": []})
        except Exception as e:
            print(f"[Character] dict.cn 备用查询失败: {e}")

    # ---------- 文言义优先使用本地文言库（含译文的精选例句）----------
    local = CLASSICAL_LOOKUP.get(char)
    if local and local.get("meanings"):
        def _norm(s):
            return re.sub(r"[，,、/。;；:：\s（）()]", "", s or "")

        local_meanings = []
        for m in local["meanings"]:
            local_meanings.append({
                "meaning": m.get("meaning", ""),
                "usage": m.get("usage", ""),
                "examples": m.get("examples", []),
            })
        # 本地库已有义项之外，保留汉典独有的文言义
        covered = [_norm(lm["meaning"]) for lm in local_meanings]
        for c in classical:
            cn = _norm(c["meaning"])
            if cn and not any(cn in t or t in cn for t in covered):
                local_meanings.append(c)
                covered.append(cn)
        classical = local_meanings
        result["classical_source"] = "local"
    elif classical:
        result["classical_source"] = "zdic"
    else:
        result["classical_source"] = None

    # 文言义必须带例句：无例句的从书证池补一条
    for c in classical:
        if not c.get("examples") and citation_pool:
            c["examples"] = citation_pool[:1]

    if not modern:
        modern = [{"number": "", "text": "暂未查询到现代文释义，建议访问汉典(zdic.net)获取更多信息。", "examples": []}]

    result["modern_meanings"] = modern
    result["classical_meanings"] = classical
    # 兼容旧字段
    result["definitions"] = [{"type": "", "number": str(i + 1), "text": m["text"]} for i, m in enumerate(modern)]
    result.setdefault("pinyin", "")
    return result

@app.route("/api/character")
def api_character():
    char = request.args.get("q", "").strip()
    if not char:
        return jsonify({"success": False, "error": "请输入要查询的汉字"})
    result = query_character(char[0])
    return jsonify(result)

# ============================================================
# 模块三：词语成语
# ============================================================

def search_word_online(keyword):
    """从百度汉语 + zdic.net 在线查询词语/成语信息。"""
    meaning = ""
    pinyin = ""
    word_pos = ""

    baidu_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://hanyu.baidu.com/",
    }

    try:
        resp = requests.get("https://hanyu.baidu.com/s", params={"wd": keyword, "ptype": "zici"}, timeout=10, headers=baidu_headers)
        if resp.status_code == 200 and len(resp.text) > 3000:
            soup = BeautifulSoup(resp.text, "html.parser")
            bodies = soup.find_all("div", class_="poem-list-item-body")
            if not bodies:
                bodies = soup.find_all(class_="check-red")
            if bodies:
                meaning = bodies[0].get_text(strip=True)
                items = soup.find_all("div", class_="poem-list-item")
                if items:
                    m = re.search(r'\[\s*([a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńň\s]+)\s*\]', items[0].get_text())
                    if m:
                        pinyin = m.group(1).strip()
            if not meaning:
                tab = soup.find(class_="tab-content")
                if tab:
                    raw_text = tab.get_text(strip=True)
                    m = re.match(r'\[([^\]]+)\]', raw_text)
                    if m:
                        pinyin = m.group(1).strip()
                    meaning = re.sub(r'^\[[^\]]+\]\s*', '', raw_text)
    except Exception as e:
        print(f"[Word] 百度汉语(ptype=zici)查询失败: {e}")

    if not meaning:
        try:
            resp = requests.get("https://hanyu.baidu.com/s", params={"wd": keyword}, timeout=10, headers=baidu_headers)
            if resp.status_code == 200 and len(resp.text) > 3000:
                soup = BeautifulSoup(resp.text, "html.parser")
                bodies = soup.find_all("div", class_="poem-list-item-body")
                if not bodies:
                    bodies = soup.find_all(class_="check-red")
                if bodies:
                    meaning = bodies[0].get_text(strip=True)
                    items = soup.find_all("div", class_="poem-list-item")
                    if items:
                        m = re.search(r'\[\s*([a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńň\s]+)\s*\]', items[0].get_text())
                        if m:
                            pinyin = m.group(1).strip()
        except Exception as e:
            print(f"[Word] 百度汉语(无ptype)查询失败: {e}")

    if not meaning:
        try:
            resp = requests.get(f"https://www.zdic.net/hans/{keyword}", timeout=10, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "zh-CN,zh;q=0.9",
            })
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                defs = soup.find_all(class_="gy-sense__def")
                if not defs:
                    defs = soup.find_all(class_="xxjs-item__def")
                if defs:
                    parts = [d.get_text(strip=True) for d in defs[:5] if d.get_text(strip=True)]
                    meaning = " ".join(parts)
                if not pinyin:
                    pinyin_elem = soup.find(class_="meta-pinyin")
                    if pinyin_elem:
                        pinyin = pinyin_elem.get_text(strip=True)
        except Exception as e:
            print(f"[Word] zdic.net 备用查询失败: {e}")

    if meaning:
        m = re.match(r'[（(](名|动|形|副|介|连|助|叹|量|代|数|拟声|形动|动名)[)）]', meaning)
        if m:
            word_pos = m.group(1)

        is_idiom = len(keyword) == 4 and all('\u4e00' <= c <= '\u9fff' for c in keyword)
        wtype = "成语" if is_idiom else "词语"

        sentiment = "中性词"
        positive_words = ["好", "美", "优", "善", "勤", "勇", "智", "伟", "杰", "卓", "精", "妙", "幸", "荣", "德", "忠", "孝", "仁", "义", "正", "高", "远", "深", "厚", "宏", "大", "盛", "兴", "旺", "达", "通", "明", "清", "新", "活", "强", "胜", "成", "创", "进", "升", "飞", "腾", "跃", "奔", "奋", "励", "毅", "坚", "恒", "稳", "安", "和", "谐", "暖", "馨", "甜", "喜", "乐", "欢", "欣", "悦", "怡", "畅", "舒"]
        negative_words = ["坏", "恶", "丑", "劣", "差", "错", "败", "衰", "退", "落", "降", "沉", "弱", "小", "微", "浅", "薄", "短", "低", "暗", "黑", "死", "亡", "伤", "痛", "苦", "难", "艰", "困", "贫", "穷", "孤", "独", "冷", "寒", "凉", "悲", "哀", "愁", "忧", "怒", "恨", "怨", "悔", "惭", "愧", "羞", "耻", "辱", "卑", "鄙", "俗", "庸", "愚", "蠢", "笨", "呆", "傻", "痴", "狂", "妄", "骄", "傲", "奢", "侈", "贪", "婪", "懒", "惰", "怠", "慢", "迟", "钝", "拙", "腐", "朽", "废", "弃", "毁", "灭", "消", "失", "没", "无", "不", "非", "未", "莫", "勿", "休", "别"]
        pos_count = sum(1 for w in positive_words if w in meaning)
        neg_count = sum(1 for w in negative_words if w in meaning)
        if pos_count > neg_count:
            sentiment = "褒义词"
        elif neg_count > pos_count:
            sentiment = "贬义词"

        return {
            "word": keyword, "pinyin": pinyin, "type": wtype, "sentiment": sentiment,
            "meaning": meaning, "context": "（在线查询结果）建议根据释义判断适用语境。",
            "examples": [], "source": "online",
        }

    return None


@app.route("/api/words")
def api_words():
    keyword = request.args.get("q", "").strip().lower()
    sentiment = request.args.get("sentiment", "").strip()
    wtype = request.args.get("type", "").strip()
    page = int(request.args.get("page", "1"))
    per_page = int(request.args.get("per_page", "20"))

    filtered = WORDS_IDIOMS_INDEX
    if keyword:
        filtered = [x for x in filtered if keyword in x["text"]]
    if sentiment:
        filtered = [x for x in filtered if x["item"].get("sentiment", "") == sentiment]
    if wtype:
        filtered = [x for x in filtered if x["item"].get("type", "") == wtype]

    total = len(filtered)
    start = (page - 1) * per_page
    end = start + per_page
    items = [x["item"] for x in filtered[start:end]]

    return jsonify({"success": True, "total": total, "page": page, "per_page": per_page, "words": items})


@app.route("/api/word/search")
def api_word_search_online():
    keyword = request.args.get("q", "").strip()
    if not keyword:
        return jsonify({"success": False, "error": "请输入搜索关键词"})

    local_match = None
    for item in WORDS_IDIOMS_DATA:
        if item.get("word", "") == keyword:
            local_match = item
            break

    if local_match:
        local_match["source"] = "local"
        return jsonify({"success": True, "word": local_match, "source": "local"})

    online_result = search_word_online(keyword)
    if online_result:
        return jsonify({"success": True, "word": online_result, "source": "online"})

    return jsonify({"success": False, "error": f"未找到「{keyword}」的相关信息"})

@app.route("/api/word/<word_id>")
def api_word_detail(word_id):
    for item in WORDS_IDIOMS_DATA:
        if str(item.get("id", "")) == str(word_id):
            return jsonify({"success": True, "word": item})
    return jsonify({"success": False, "error": "未找到该词条"})

@app.route("/api/words/sentiments")
def api_word_sentiments():
    from collections import Counter
    counts = Counter(item.get("sentiment", "") for item in WORDS_IDIOMS_DATA)
    return jsonify({"success": True, "sentiments": dict(counts)})

# ============================================================
# 模块四：情景默写
# ============================================================
DICTATION_BY_LEVEL = {"初中": [], "高中": []}
for item in DICTATION_DATA:
    level = item.get("level", "初中")
    if level in DICTATION_BY_LEVEL:
        DICTATION_BY_LEVEL[level].append(item)

@app.route("/api/dictation")
def api_dictation():
    level = request.args.get("level", "初中").strip()
    count = int(request.args.get("count", "10"))

    questions = DICTATION_BY_LEVEL.get(level, [])
    if not questions:
        return jsonify({"success": False, "error": f"未找到{level}的默写题目"})

    if count >= len(questions):
        selected = questions[:]
    else:
        selected = random.sample(questions, count)

    items = []
    for q in selected:
        items.append({
            "id": q["id"], "level": q["level"], "poem_title": q["poem_title"],
            "author": q["author"], "dynasty": q["dynasty"], "context": q["context"],
            "answer": q["answer"], "hint": q.get("hint", "")
        })

    return jsonify({"success": True, "level": level, "count": len(items), "total_available": len(questions), "questions": items})

@app.route("/api/dictation/count")
def api_dictation_count():
    return jsonify({"success": True, "counts": {"初中": len(DICTATION_BY_LEVEL["初中"]), "高中": len(DICTATION_BY_LEVEL["高中"])}})

@app.route("/api/dictation/list")
def api_dictation_list():
    level = request.args.get("level", "").strip()
    keyword = request.args.get("q", "").strip()
    page = int(request.args.get("page", "1"))
    per_page = int(request.args.get("per_page", "20"))

    items = DICTATION_DATA
    if level:
        items = [q for q in items if q.get("level") == level]
    if keyword:
        kw = keyword.lower()
        items = [q for q in items if kw in q.get("poem_title", "").lower() or
                 kw in q.get("author", "").lower() or
                 kw in q.get("context", "").lower() or
                 kw in q.get("answer", "").lower()]

    total = len(items)
    start = (page - 1) * per_page
    end = start + per_page
    page_items = items[start:end]

    return jsonify({
        "success": True, "total": total, "page": page, "per_page": per_page,
        "counts": {"初中": len(DICTATION_BY_LEVEL["初中"]), "高中": len(DICTATION_BY_LEVEL["高中"])},
        "questions": page_items,
    })

@app.route("/api/dictation/add", methods=["POST"])
def api_dictation_add():
    data = request.get_json(silent=True) or request.form
    level = (data.get("level") or "").strip()
    poem_title = (data.get("poem_title") or "").strip()
    author = (data.get("author") or "").strip()
    dynasty = (data.get("dynasty") or "").strip()
    context = (data.get("context") or "").strip()
    answer = (data.get("answer") or "").strip()
    hint = (data.get("hint") or "").strip()

    if not all([level, poem_title, author, context, answer]):
        return jsonify({"success": False, "error": "请填写：级别、篇名、作者、题目情境、答案"})

    if level not in ("初中", "高中"):
        return jsonify({"success": False, "error": "级别必须为'初中'或'高中'"})

    max_id = max(q["id"] for q in DICTATION_DATA) if DICTATION_DATA else 0
    new_id = max_id + 1

    new_question = {
        "id": new_id, "level": level, "poem_title": poem_title,
        "author": author, "dynasty": dynasty or "不详", "context": context,
        "answer": answer, "hint": hint,
    }

    DICTATION_DATA.append(new_question)
    try:
        dictation_path = DATA_DIR / "dictation.json"
        with open(dictation_path, "w", encoding="utf-8") as f:
            json.dump(DICTATION_DATA, f, ensure_ascii=False, indent=2)
        DICTATION_BY_LEVEL.setdefault(level, []).append(new_question)
    except Exception as e:
        DICTATION_DATA.pop()
        return jsonify({"success": False, "error": f"保存失败: {e}"})

    return jsonify({"success": True, "message": f"题目添加成功（ID: {new_id}）", "question": new_question})

@app.route("/api/dictation/delete", methods=["POST"])
def api_dictation_delete():
    data = request.get_json(silent=True) or request.form
    try:
        qid = int(data.get("id", 0))
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "无效的题目ID"})

    target = None
    for i, q in enumerate(DICTATION_DATA):
        if q["id"] == qid:
            target = q
            target_index = i
            break

    if not target:
        return jsonify({"success": False, "error": f"未找到ID为 {qid} 的题目"})

    level = target.get("level", "")
    DICTATION_DATA.pop(target_index)
    try:
        dictation_path = DATA_DIR / "dictation.json"
        with open(dictation_path, "w", encoding="utf-8") as f:
            json.dump(DICTATION_DATA, f, ensure_ascii=False, indent=2)
        if level in DICTATION_BY_LEVEL:
            DICTATION_BY_LEVEL[level] = [q for q in DICTATION_BY_LEVEL[level] if q["id"] != qid]
    except Exception as e:
        return jsonify({"success": False, "error": f"保存失败: {e}"})

    return jsonify({"success": True, "message": f"已删除题目（ID: {qid}）"})

# ============================================================
# 模块五：文言实词虚词
# ============================================================

@app.route("/api/classical")
def api_classical():
    keyword = request.args.get("q", "").strip()
    wtype = request.args.get("type", "").strip()
    page = int(request.args.get("page", "1"))
    per_page = int(request.args.get("per_page", "30"))

    filtered = CLASSICAL_WORDS_DATA
    if wtype:
        filtered = [x for x in filtered if x.get("type", "") == wtype]
    if keyword:
        kw = keyword.lower()
        filtered = [x for x in filtered if kw in x.get("word", "").lower() or
                    kw in x.get("pinyin", "").lower() or
                    any(kw in m.get("meaning", "").lower() or kw in m.get("usage", "").lower()
                        for m in x.get("meanings", []))]

    total = len(filtered)
    start = (page - 1) * per_page
    end = start + per_page
    items = filtered[start:end]

    result_items = []
    for item in items:
        meanings_brief = []
        for m in item.get("meanings", []):
            meanings_brief.append({"usage": m.get("usage", ""), "meaning": m.get("meaning", "")})
        result_items.append({
            "id": item.get("id", ""), "word": item.get("word", ""),
            "pinyin": item.get("pinyin", ""), "type": item.get("type", ""),
            "meanings_brief": meanings_brief,
        })

    xuci_count = sum(1 for x in CLASSICAL_WORDS_DATA if x.get("type") == "虚词")
    shici_count = sum(1 for x in CLASSICAL_WORDS_DATA if x.get("type") == "实词")

    return jsonify({
        "success": True, "total": total, "page": page, "per_page": per_page,
        "xuci_count": xuci_count, "shici_count": shici_count, "words": result_items,
    })


@app.route("/api/classical/<word_id>")
def api_classical_detail(word_id):
    for item in CLASSICAL_WORDS_DATA:
        if str(item.get("id", "")) == str(word_id):
            return jsonify({"success": True, "word": item})
    return jsonify({"success": False, "error": "未找到该词条"})


@app.route("/api/classical/quiz")
def api_classical_quiz():
    wtype = request.args.get("type", "").strip()
    count = int(request.args.get("count", "10"))
    qtype = request.args.get("qtype", "").strip()

    pool = CLASSICAL_WORDS_DATA
    if wtype:
        pool = [x for x in pool if x.get("type") == wtype]

    if len(pool) < 4:
        return jsonify({"success": False, "error": "词条数量不足，至少需要4个词条才能出题"})

    available_types = []
    if any(w.get("meanings") for w in pool):
        available_types.append("meaning_choice")
    pool_with_examples = [w for w in pool if any(
        ex.get("sentence") for m in w.get("meanings", []) for ex in m.get("examples", [])
    )]
    if pool_with_examples:
        available_types.append("usage_choice")
        available_types.append("fill_blank")

    if not available_types:
        return jsonify({"success": False, "error": "没有足够的词条来生成题目"})

    questions = []
    used_words = set()

    if qtype and qtype in available_types:
        available_types = [qtype]

    attempt_count = 0
    max_attempts = count * 5

    while len(questions) < count and attempt_count < max_attempts:
        attempt_count += 1
        chosen_type = random.choice(available_types)

        if chosen_type == "meaning_choice":
            candidates = [w for w in pool if w["word"] not in used_words]
            if not candidates:
                candidates = pool
            target = random.choice(candidates)
            used_words.add(target["word"])

            meanings = target.get("meanings", [])
            if not meanings:
                continue
            correct_meaning = random.choice(meanings)

            other_words = [w for w in pool if w["word"] != target["word"]]
            if len(other_words) < 3:
                other_words = pool
            distractors = []
            random.shuffle(other_words)
            for ow in other_words:
                if len(distractors) >= 3:
                    break
                ow_meanings = ow.get("meanings", [])
                if ow_meanings:
                    dm = random.choice(ow_meanings)
                    distractors.append({"usage": dm.get("usage", ""), "meaning": dm.get("meaning", "")})

            if len(distractors) < 3:
                continue

            options = [{"usage": correct_meaning.get("usage", ""), "meaning": correct_meaning.get("meaning", "")}] + distractors
            random.shuffle(options)
            correct_index = next(i for i, o in enumerate(options) if o["meaning"] == correct_meaning.get("meaning", ""))

            example_sentence = ""
            example_source = ""
            example_translation = ""
            for ex in correct_meaning.get("examples", []):
                if ex.get("sentence"):
                    example_sentence = ex["sentence"]
                    example_source = ex.get("source", "")
                    example_translation = ex.get("translation", "")
                    break

            questions.append({
                "id": f"q_{len(questions)+1}", "type": "meaning_choice", "type_label": "释义选择",
                "word": target["word"], "pinyin": target.get("pinyin", ""), "word_type": target.get("type", ""),
                "question": f"「{target['word']}」在文言文中的释义是？",
                "example_sentence": example_sentence, "example_source": example_source, "example_translation": example_translation,
                "options": [f"【{o['usage']}】{o['meaning']}" for o in options],
                "correct_index": correct_index,
                "explanation": f"「{target['word']}」({target.get('pinyin','')}) 作为{correct_meaning.get('usage','')}，意为：{correct_meaning.get('meaning','')}",
            })

        elif chosen_type == "usage_choice":
            candidates = [w for w in pool_with_examples if w["word"] not in used_words]
            if not candidates:
                candidates = pool_with_examples
            target = random.choice(candidates)
            used_words.add(target["word"])

            meanings_with_ex = [m for m in target.get("meanings", []) if m.get("examples")]
            if not meanings_with_ex:
                continue
            correct_m = random.choice(meanings_with_ex)
            correct_ex = random.choice(correct_m["examples"])
            if not correct_ex.get("sentence"):
                continue

            other_meanings = [m for m in target.get("meanings", []) if m is not correct_m]
            if len(other_meanings) < 3:
                for w in pool:
                    if w["word"] == target["word"]:
                        continue
                    for m in w.get("meanings", []):
                        if len(other_meanings) >= 3:
                            break
                        other_meanings.append(m)
                    if len(other_meanings) >= 3:
                        break

            if len(other_meanings) < 3:
                continue

            distractors = random.sample(other_meanings, min(3, len(other_meanings)))
            options = [correct_m] + distractors[:3]
            while len(options) < 4:
                options.append({"usage": "其他", "meaning": "以上都不是"})
            random.shuffle(options)
            correct_index = next(i for i, o in enumerate(options) if o.get("meaning") == correct_m.get("meaning"))

            questions.append({
                "id": f"q_{len(questions)+1}", "type": "usage_choice", "type_label": "用法选择",
                "word": target["word"], "pinyin": target.get("pinyin", ""), "word_type": target.get("type", ""),
                "question": f"下列句中「{target['word']}」的用法/意义是？",
                "example_sentence": correct_ex.get("sentence", ""), "example_source": correct_ex.get("source", ""),
                "example_translation": correct_ex.get("translation", ""),
                "options": [f"【{o.get('usage','')}】{o.get('meaning','')}" for o in options],
                "correct_index": correct_index,
                "explanation": f"此句中「{target['word']}」为{correct_m.get('usage','')}，意为：{correct_m.get('meaning','')}",
            })

        elif chosen_type == "fill_blank":
            candidates = [w for w in pool_with_examples if w["word"] not in used_words]
            if not candidates:
                candidates = pool_with_examples
            target = random.choice(candidates)
            used_words.add(target["word"])

            meanings_with_ex = [m for m in target.get("meanings", []) if m.get("examples")]
            if not meanings_with_ex:
                continue
            correct_m = random.choice(meanings_with_ex)
            correct_ex = random.choice(correct_m["examples"])
            sentence = correct_ex.get("sentence", "")
            if not sentence or target["word"] not in sentence:
                continue

            blank_sentence = sentence.replace(target["word"], "＿＿＿", 1)

            other_words = [w for w in pool if w["word"] != target["word"]]
            if len(other_words) < 3:
                continue
            distractors = random.sample(other_words, 3)
            distractor_words = [w["word"] for w in distractors]

            options = [target["word"]] + distractor_words
            random.shuffle(options)
            correct_index = options.index(target["word"])

            questions.append({
                "id": f"q_{len(questions)+1}", "type": "fill_blank", "type_label": "填空选择",
                "word": target["word"], "pinyin": target.get("pinyin", ""), "word_type": target.get("type", ""),
                "question": "填入句中空白处的正确词语是？",
                "example_sentence": blank_sentence, "example_source": correct_ex.get("source", ""),
                "example_translation": correct_ex.get("translation", ""),
                "options": options, "correct_index": correct_index,
                "explanation": f"正确答案为「{target['word']}」。{correct_m.get('usage','')}，意为：{correct_m.get('meaning','')}",
            })

    return jsonify({"success": True, "count": len(questions), "questions": questions})


# ============================================================
# 改病句 / 找错别字 板块
# ============================================================
@app.route("/api/sentence/info")
def sentence_info():
    return jsonify({
        "success": True,
        "types": SENTENCE_ERRORS_DATA.get("types", []),
        "count": len(SENTENCE_ERRORS_DATA.get("questions", [])),
    })


@app.route("/api/sentence/quiz")
def sentence_quiz():
    count = min(request.args.get("count", 5, type=int), 10)
    qs = SENTENCE_ERRORS_DATA.get("questions", [])
    selected = random.sample(qs, min(count, len(qs)))
    return jsonify({"success": True, "count": len(selected), "questions": selected})


@app.route("/api/typo/info")
def typo_info():
    return jsonify({
        "success": True,
        "types": TYPO_QUESTIONS_DATA.get("types", []),
        "count": len(TYPO_QUESTIONS_DATA.get("questions", [])),
    })


@app.route("/api/typo/quiz")
def typo_quiz():
    count = min(request.args.get("count", 5, type=int), 10)
    qs = TYPO_QUESTIONS_DATA.get("questions", [])
    selected = random.sample(qs, min(count, len(qs)))
    return jsonify({"success": True, "count": len(selected), "questions": selected})


# ============================================================
# 主页面
# ============================================================
@app.route("/")
def index():
    return render_template("index.html")

if __name__ == "__main__":
    print("=" * 50)
    print("  文渊阁 启动中...")
    print(f"  词语成语数据: {len(WORDS_IDIOMS_DATA)} 条")
    print(f"  情景默写数据: 初中 {len(DICTATION_BY_LEVEL['初中'])} 题, 高中 {len(DICTATION_BY_LEVEL['高中'])} 题")
    print(f"  文言实词虚词: {len(CLASSICAL_WORDS_DATA)} 条")
    print("=" * 50)
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
