/**
 * 文渊阁 - 前端交互
 * 模块：时政热点 / 汉字查询 / 词语成语 / 情景默写
 */

// ===== 工具函数 =====
function $(selector) {
    return document.querySelector(selector);
}

function $$(selector) {
    return document.querySelectorAll(selector);
}

function formatDate() {
    const now = new Date();
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${days[now.getDay()]}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', function() {
    $('#headerDate').textContent = formatDate();
    initTabs();
    initCharacter();
    initWords();
    initDictation();
    initClassical();
    initSentenceErrors();
    initTypo();
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalOverlay').addEventListener('click', function(e) {
        if (e.target === this) closeModal();
    });
});

// ===== Tab切换 =====
function initTabs() {
    $$('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const target = this.dataset.tab;
            $$('.nav-tab').forEach(t => t.classList.remove('active'));
            $$('.tab-panel').forEach(p => p.classList.remove('active'));
            this.classList.add('active');
            $(`#panel-${target}`).classList.add('active');
        });
    });
}

// ===== 汉字查询 =====
function initCharacter() {
    $('#btnSearchChar').addEventListener('click', searchCharacter);
    $('#charInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') searchCharacter();
    });
}

async function searchCharacter() {
    const char = $('#charInput').value.trim();
    if (!char) {
        $('#charResult').innerHTML = '<div class="empty-placeholder">请输入要查询的汉字</div>';
        return;
    }
    $('#charResult').innerHTML = '<div class="loading-placeholder">正在查询...</div>';
    try {
        const resp = await fetch(`/api/character?q=${encodeURIComponent(char[0])}`);
        const data = await resp.json();
        if (data.success) {
            renderCharacter(data);
        } else {
            $('#charResult').innerHTML = `<div class="empty-placeholder">${escapeHtml(data.error || '查询失败')}</div>`;
        }
    } catch (error) {
        $('#charResult').innerHTML = '<div class="empty-placeholder">查询失败，请稍后重试</div>';
        console.error('Character error:', error);
    }
}

function renderCharacter(data) {
    // 构建基本信息卡片
    const infoItems = [];
    if (data.pinyin) infoItems.push({ label: '拼音', value: data.pinyin });
    if (data.zhuyin) infoItems.push({ label: '注音', value: data.zhuyin });
    if (data.unicode) infoItems.push({ label: 'Unicode', value: data.unicode });
    if (data.radical) infoItems.push({ label: '部首', value: data.radical });
    if (data.strokes) infoItems.push({ label: '总笔画', value: data.strokes });
    if (data.structure) infoItems.push({ label: '字形结构', value: data.structure });
    if (data.wubi) infoItems.push({ label: '五笔', value: data.wubi });

    const infoHtml = infoItems.length > 0 ? `
        <div class="char-info-grid">
            ${infoItems.map(item => `
                <div class="char-info-item">
                    <div class="char-info-label">${escapeHtml(item.label)}</div>
                    <div class="char-info-value">${escapeHtml(item.value)}</div>
                </div>
            `).join('')}
        </div>
    ` : '';

    // ===== 现代文释义 =====
    const modern = data.modern_meanings || [];
    let modernHtml = '';
    if (modern.length > 0) {
        modernHtml = `
            <div class="meaning-section meaning-section--modern">
                <div class="meaning-section-title">
                    <span class="meaning-section-icon">今</span>
                    现代文释义
                </div>
                <div class="meaning-section-body">
                    ${modern.map((m, i) => `
                        <div class="modern-entry">
                            <span class="def-num-badge">${m.number || i + 1}</span>
                            <div class="modern-entry-content">
                                <div class="modern-entry-text">${escapeHtml(m.text)}</div>
                                ${m.examples && m.examples.length && m.examples[0] ? `
                                    <div class="modern-entry-eg">例如：${escapeHtml(m.examples[0])}</div>
                                ` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // ===== 文言文释义（每个义项配具体文言例句）=====
    const classical = data.classical_meanings || [];
    let classicalHtml = '';
    if (classical.length > 0) {
        classicalHtml = `
            <div class="meaning-section meaning-section--classical">
                <div class="meaning-section-title">
                    <span class="meaning-section-icon meaning-section-icon--classical">古</span>
                    文言文释义
                </div>
                <div class="meaning-section-body">
                    ${classical.map(c => `
                        <div class="classical-entry">
                            <div class="classical-entry-head">
                                ${c.usage ? `<span class="def-pos-badge">${escapeHtml(c.usage)}</span>` : ''}
                                <span class="classical-entry-meaning">${escapeHtml(c.meaning)}</span>
                            </div>
                            ${(c.examples || []).slice(0, 2).map(ex => `
                                <div class="classical-example">
                                    <div class="classical-example-sentence">${escapeHtml(ex.sentence)}</div>
                                    <div class="classical-example-meta">
                                        <span class="classical-example-source">——${escapeHtml(ex.source)}</span>
                                        ${ex.translation ? `<span class="classical-example-trans">【译】${escapeHtml(ex.translation)}</span>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else {
        classicalHtml = `
            <div class="meaning-section meaning-section--classical">
                <div class="meaning-section-title">
                    <span class="meaning-section-icon meaning-section-icon--classical">古</span>
                    文言文释义
                </div>
                <div class="meaning-section-body">
                    <div class="empty-placeholder">该字暂未收录文言用法</div>
                </div>
            </div>
        `;
    }

    const html = `
        <div class="char-display">
            <div class="char-display-main">${escapeHtml(data.character)}</div>
            ${data.pinyin ? `<div class="char-display-pinyin">${escapeHtml(data.pinyin)}</div>` : ''}
        </div>
        ${infoHtml}
        ${modernHtml}
        ${classicalHtml}
    `;
    $('#charResult').innerHTML = html;
}

// ===== 词语成语 =====
let wordPage = 1;
const wordPerPage = 20;

function initWords() {
    loadWords();
    $('#btnSearchWord').addEventListener('click', () => {
        wordPage = 1;
        loadWords();
    });
    $('#wordSearch').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            wordPage = 1;
            loadWords();
        }
    });
    $('#wordSentiment').addEventListener('change', () => {
        wordPage = 1;
        loadWords();
    });
    $('#wordType').addEventListener('change', () => {
        wordPage = 1;
        loadWords();
    });
    const btnReset = $('#btnResetWord');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            $('#wordSearch').value = '';
            $('#wordSentiment').value = '';
            $('#wordType').value = '';
            wordPage = 1;
            loadWords();
        });
    }
}

async function loadWords() {
    const keyword = $('#wordSearch').value.trim();
    const sentiment = $('#wordSentiment').value;
    const wtype = $('#wordType').value;
    const listEl = $('#wordList');
    listEl.innerHTML = '<div class="loading-placeholder">加载中...</div>';
    try {
        const params = new URLSearchParams({ page: wordPage, per_page: wordPerPage });
        if (keyword) params.set('q', keyword);
        if (sentiment) params.set('sentiment', sentiment);
        if (wtype) params.set('type', wtype);
        const resp = await fetch(`/api/words?${params}`);
        const data = await resp.json();
        if (data.success) {
            $('#wordCount').textContent = `共 ${data.total} 条`;
            renderWords(data.words);
            renderWordPagination(data.total, data.page, data.per_page);

            // 本地搜索无结果且有关键词 → 自动在线查询百度汉语
            if (data.total === 0 && keyword) {
                listEl.innerHTML = `<div class="loading-placeholder">本地词库未找到「${escapeHtml(keyword)}」，正在从百度汉语在线查询...</div>`;
                try {
                    const onlineResp = await fetch(`/api/word/search?q=${encodeURIComponent(keyword)}`);
                    const onlineData = await onlineResp.json();
                    if (onlineData.success) {
                        renderOnlineWordResult(onlineData.word, keyword);
                    } else {
                        listEl.innerHTML = `<div class="empty-placeholder">未找到「${escapeHtml(keyword)}」的相关信息，请尝试其他关键词</div>`;
                    }
                } catch (onlineErr) {
                    listEl.innerHTML = '<div class="empty-placeholder">在线查询失败，请稍后重试</div>';
                    console.error('Online word search error:', onlineErr);
                }
            }
        }
    } catch (error) {
        listEl.innerHTML = '<div class="empty-placeholder">加载失败</div>';
        console.error('Words error:', error);
    }
}

function getSentimentClass(sentiment) {
    if (sentiment === '褒义词') return 'sentiment-positive';
    if (sentiment === '贬义词') return 'sentiment-negative';
    return 'sentiment-neutral';
}

function renderWords(words) {
    if (!words || words.length === 0) {
        $('#wordList').innerHTML = '<div class="empty-placeholder">未找到相关词条</div>';
        return;
    }
    const html = words.map(item => `
        <div class="word-card" onclick="showWordDetail(${item.id})">
            <div class="word-card-header">
                <span class="word-card-word">${escapeHtml(item.word)}</span>
                <span class="word-card-pinyin">${escapeHtml(item.pinyin || '')}</span>
                <span class="word-card-type type-badge">${escapeHtml(item.type || '')}</span>
                <span class="word-card-sentiment sentiment-badge ${getSentimentClass(item.sentiment)}">${escapeHtml(item.sentiment || '')}</span>
            </div>
            <div class="word-card-meaning">${escapeHtml((item.meaning || '').substring(0, 80))}${item.meaning && item.meaning.length > 80 ? '...' : ''}</div>
            <div class="word-card-footer">
                <span class="card-detail-link">查看详情 →</span>
            </div>
        </div>
    `).join('');
    $('#wordList').innerHTML = html;
}

// 在线搜索结果展示
let onlineWordResult = null;

function renderOnlineWordResult(word, keyword) {
    onlineWordResult = word;
    const sentimentClass = getSentimentClass(word.sentiment);
    const sourceBadge = word.source === 'online'
        ? '<span class="source-badge online">在线查询</span>'
        : '<span class="source-badge local">本地词库</span>';

    const html = `
        <div class="word-card online-result" onclick="showOnlineWordDetail()">
            <div class="word-card-header">
                <span class="word-card-word">${escapeHtml(word.word)}</span>
                <span class="word-card-pinyin">${escapeHtml(word.pinyin || '')}</span>
                <span class="word-card-type type-badge">${escapeHtml(word.type || '')}</span>
                <span class="word-card-sentiment sentiment-badge ${sentimentClass}">${escapeHtml(word.sentiment || '')}</span>
                ${sourceBadge}
            </div>
            <div class="word-card-meaning">${escapeHtml((word.meaning || '').substring(0, 120))}${word.meaning && word.meaning.length > 120 ? '...' : ''}</div>
            <div class="word-card-footer">
                <span class="card-detail-link">查看详情 →</span>
            </div>
        </div>
    `;
    $('#wordList').innerHTML = html;
    $('#wordPagination').innerHTML = '';
    $('#wordCount').textContent = `在线查询结果`;
}

function showOnlineWordDetail() {
    if (onlineWordResult) {
        renderWordModal(onlineWordResult);
    }
}

function renderWordPagination(total, page, perPage) {
    const totalPages = Math.ceil(total / perPage);
    if (totalPages <= 1) {
        $('#wordPagination').innerHTML = '';
        return;
    }
    let html = '';
    html += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="changeWordPage(${page - 1})">上一页</button>`;
    const maxButtons = 5;
    let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="changeWordPage(${i})">${i}</button>`;
    }
    html += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="changeWordPage(${page + 1})">下一页</button>`;
    $('#wordPagination').innerHTML = html;
}

function changeWordPage(page) {
    wordPage = page;
    loadWords();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function showWordDetail(id) {
    try {
        const resp = await fetch(`/api/word/${id}`);
        const data = await resp.json();
        if (data.success) {
            renderWordModal(data.word);
        }
    } catch (error) {
        console.error('Word detail error:', error);
    }
}

// ===== 情景默写 =====
let currentLevel = '初中';
let currentQuestions = [];
let showAnswers = false;
let bankPage = 1;
const bankPerPage = 15;

function initDictation() {
    // 默写练习 / 题库管理 切换
    $$('[data-dict-mode]').forEach(tab => {
        tab.addEventListener('click', function() {
            $$('[data-dict-mode]').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            const mode = this.dataset.dictMode;
            if (mode === 'practice') {
                $('#dictationPracticeMode').style.display = '';
                $('#dictationManageMode').style.display = 'none';
            } else {
                $('#dictationPracticeMode').style.display = 'none';
                $('#dictationManageMode').style.display = '';
                loadBank();
            }
        });
    });

    // 初中/高中切换（仅在练习模式内）
    $('#dictationPracticeMode').querySelectorAll('.level-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            $('#dictationPracticeMode').querySelectorAll('.level-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            currentLevel = this.dataset.level;
        });
    });
    // 开始默写按钮
    $('#btnNewDictation').addEventListener('click', loadDictation);
    // 显示/隐藏答案
    $('#btnShowAnswers').addEventListener('click', toggleAnswers);

    // 题库管理
    $('#btnAddQuestion').addEventListener('click', addNewQuestion);
    $('#btnSearchBank').addEventListener('click', () => { bankPage = 1; loadBank(); });
    $('#bankSearch').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { bankPage = 1; loadBank(); }
    });
    $('#bankLevel').addEventListener('change', () => { bankPage = 1; loadBank(); });
}

async function loadDictation() {
    const count = $('#dictationCount').value;
    const listEl = $('#dictationList');
    listEl.innerHTML = '<div class="loading-placeholder">正在出题...</div>';
    $('#dictationResult').style.display = 'none';

    try {
        const resp = await fetch(`/api/dictation?level=${encodeURIComponent(currentLevel)}&count=${count}`);
        const data = await resp.json();
        if (data.success) {
            currentQuestions = data.questions;
            $('#dictationInfo').textContent = `${currentLevel} · 题库共 ${data.total_available} 题`;
            renderDictation(data.questions);
        } else {
            listEl.innerHTML = `<div class="empty-placeholder">${escapeHtml(data.error || '出题失败')}</div>`;
        }
    } catch (error) {
        listEl.innerHTML = '<div class="empty-placeholder">出题失败，请稍后重试</div>';
        console.error('Dictation error:', error);
    }
}

function renderDictation(questions) {
    if (!questions || questions.length === 0) {
        $('#dictationList').innerHTML = '<div class="empty-placeholder">暂无题目</div>';
        return;
    }

    const html = questions.map((q, i) => `
        <div class="dictation-item" data-id="${q.id}">
            <div class="dictation-item-header">
                <span class="dictation-num">第 ${i + 1} 题</span>
                <span class="dictation-source">${escapeHtml(q.poem_title)} · ${escapeHtml(q.author)}（${escapeHtml(q.dynasty)}）</span>
            </div>
            <div class="dictation-context">${escapeHtml(q.context)}</div>
            <div class="dictation-input-area">
                <input type="text" class="dictation-input" data-index="${i}" placeholder="请填写默写内容...">
                <button class="btn btn-sm btn-check" onclick="checkOneAnswer(${i})">核对</button>
            </div>
            <div class="dictation-feedback" id="feedback-${i}"></div>
            ${showAnswers ? `<div class="dictation-answer-reveal"><span class="answer-label">答案：</span><span class="answer-text">${escapeHtml(q.answer)}</span></div>` : ''}
            ${q.hint ? `<div class="dictation-hint"><span class="hint-label">提示：</span>${escapeHtml(q.hint)}</div>` : ''}
        </div>
    `).join('');
    $('#dictationList').innerHTML = html;

    // 绑定输入框回车
    $$('.dictation-input').forEach(input => {
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                const idx = parseInt(this.dataset.index);
                checkOneAnswer(idx);
            }
        });
    });
}

function checkOneAnswer(index) {
    const question = currentQuestions[index];
    if (!question) return;

    const input = $(`.dictation-input[data-index="${index}"]`);
    const feedback = $(`#feedback-${index}`);
    const userInput = input.value.trim();

    if (!userInput) {
        feedback.innerHTML = '<span class="feedback-warn">请先填写答案</span>';
        feedback.className = 'dictation-feedback feedback-show warn';
        return;
    }

    // 比较答案（忽略空格和标点差异）
    const normalize = (s) => s.replace(/[\s，。、；：！？""''（）().,;:!?'"]/g, '');
    const userNorm = normalize(userInput);
    const answerNorm = normalize(question.answer);

    if (userNorm === answerNorm) {
        feedback.innerHTML = '<span class="feedback-correct">✓ 正确！</span>';
        feedback.className = 'dictation-feedback feedback-show correct';
        input.classList.add('input-correct');
        input.classList.remove('input-wrong');
    } else {
        feedback.innerHTML = `
            <span class="feedback-wrong">✗ 不正确</span>
            <div class="feedback-answer">正确答案：${escapeHtml(question.answer)}</div>
        `;
        feedback.className = 'dictation-feedback feedback-show wrong';
        input.classList.add('input-wrong');
        input.classList.remove('input-correct');
    }
}

function checkAllAnswers() {
    currentQuestions.forEach((_, i) => checkOneAnswer(i));

    // 统计成绩
    let correct = 0;
    let answered = 0;
    currentQuestions.forEach((_, i) => {
        const input = $(`.dictation-input[data-index="${i}"]`);
        if (input && input.value.trim()) {
            answered++;
            if (input.classList.contains('input-correct')) {
                correct++;
            }
        }
    });

    const resultEl = $('#dictationResult');
    const scoreEl = $('#resultScore');
    const detailEl = $('#resultDetail');

    if (answered > 0) {
        const score = Math.round((correct / currentQuestions.length) * 100);
        scoreEl.textContent = `得分：${score} 分`;
        detailEl.textContent = `答对 ${correct} / ${currentQuestions.length} 题（已答 ${answered} 题）`;
        resultEl.style.display = 'block';
        resultEl.scrollIntoView({ behavior: 'smooth' });
    }
}

function toggleAnswers() {
    showAnswers = !showAnswers;
    // 重新渲染当前题目
    if (currentQuestions.length > 0) {
        renderDictation(currentQuestions);
    }
    // 如果已有答题记录，也统计
    if (showAnswers) {
        checkAllAnswers();
    }
}

// ===== 题库管理 =====
async function loadBank() {
    const level = $('#bankLevel').value;
    const keyword = $('#bankSearch').value.trim();
    const listEl = $('#bankList');
    listEl.innerHTML = '<div class="loading-placeholder">加载中...</div>';
    try {
        const params = new URLSearchParams({ page: bankPage, per_page: bankPerPage });
        if (level) params.set('level', level);
        if (keyword) params.set('q', keyword);
        const resp = await fetch(`/api/dictation/list?${params}`);
        const data = await resp.json();
        if (data.success) {
            $('#bankStats').innerHTML = `共 <strong>${data.total}</strong> 题（初中 ${data.counts['初中']} 题 + 高中 ${data.counts['高中']} 题）`;
            renderBankList(data.questions);
            renderBankPagination(data.total, data.page, data.per_page);
        }
    } catch (error) {
        listEl.innerHTML = '<div class="empty-placeholder">加载失败</div>';
        console.error('Bank list error:', error);
    }
}

function renderBankList(questions) {
    if (!questions || questions.length === 0) {
        $('#bankList').innerHTML = '<div class="empty-placeholder">暂无题目</div>';
        return;
    }
    const html = questions.map(q => `
        <div class="bank-item">
            <div class="bank-item-header">
                <span class="bank-item-level ${q.level === '高中' ? 'level-gaozhong' : 'level-chuzhong'}">${escapeHtml(q.level)}</span>
                <span class="bank-item-title">${escapeHtml(q.poem_title)}</span>
                <span class="bank-item-author">${escapeHtml(q.author)}（${escapeHtml(q.dynasty || '')}）</span>
                <span class="bank-item-id">ID: ${q.id}</span>
                <button class="btn btn-sm btn-danger" onclick="deleteQuestion(${q.id})">删除</button>
            </div>
            <div class="bank-item-context">${escapeHtml(q.context)}</div>
            <div class="bank-item-answer"><span class="answer-label">答案：</span>${escapeHtml(q.answer)}</div>
            ${q.hint ? `<div class="bank-item-hint"><span class="hint-label">提示：</span>${escapeHtml(q.hint)}</div>` : ''}
        </div>
    `).join('');
    $('#bankList').innerHTML = html;
}

function renderBankPagination(total, page, perPage) {
    const totalPages = Math.ceil(total / perPage);
    if (totalPages <= 1) {
        $('#bankPagination').innerHTML = '';
        return;
    }
    let html = `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="changeBankPage(${page - 1})">上一页</button>`;
    const maxButtons = 5;
    let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="changeBankPage(${i})">${i}</button>`;
    }
    html += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="changeBankPage(${page + 1})">下一页</button>`;
    $('#bankPagination').innerHTML = html;
}

function changeBankPage(page) {
    bankPage = page;
    loadBank();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function addNewQuestion() {
    const level = $('#newQLevel').value;
    const poem_title = $('#newQTitle').value.trim();
    const author = $('#newQAuthor').value.trim();
    const dynasty = $('#newQDynasty').value.trim();
    const context = $('#newQContext').value.trim();
    const answer = $('#newQAnswer').value.trim();
    const hint = $('#newQHint').value.trim();

    if (!poem_title || !author || !context || !answer) {
        alert('请填写：篇名、作者、题目情境、答案');
        return;
    }

    try {
        const resp = await fetch('/api/dictation/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level, poem_title, author, dynasty, context, answer, hint }),
        });
        const data = await resp.json();
        if (data.success) {
            alert(data.message);
            // 清空表单
            $('#newQTitle').value = '';
            $('#newQAuthor').value = '';
            $('#newQDynasty').value = '';
            $('#newQContext').value = '';
            $('#newQAnswer').value = '';
            $('#newQHint').value = '';
            // 刷新列表
            loadBank();
        } else {
            alert(data.error || '添加失败');
        }
    } catch (error) {
        alert('添加失败，请稍后重试');
        console.error('Add question error:', error);
    }
}

async function deleteQuestion(qid) {
    if (!confirm(`确定删除题目（ID: ${qid}）吗？此操作不可撤销。`)) return;
    try {
        const resp = await fetch('/api/dictation/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: qid }),
        });
        const data = await resp.json();
        if (data.success) {
            alert(data.message);
            loadBank();
        } else {
            alert(data.error || '删除失败');
        }
    } catch (error) {
        alert('删除失败，请稍后重试');
        console.error('Delete question error:', error);
    }
}

// ===== 文言实词虚词 =====
let classicalPage = 1;
const classicalPerPage = 30;
let classicalQuizQuestions = [];
let classicalQuizMode = 'dict'; // 'dict' or 'quiz'

function initClassical() {
    loadClassical();

    // 搜索
    $('#btnSearchClassical').addEventListener('click', () => {
        classicalPage = 1;
        loadClassical();
    });
    $('#classicalSearch').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            classicalPage = 1;
            loadClassical();
        }
    });
    $('#classicalType').addEventListener('change', () => {
        classicalPage = 1;
        loadClassical();
    });
    $('#btnResetClassical').addEventListener('click', () => {
        $('#classicalSearch').value = '';
        $('#classicalType').value = '';
        classicalPage = 1;
        loadClassical();
    });

    // 子模块切换
    $$('[data-cl-mode]').forEach(tab => {
        tab.addEventListener('click', function() {
            $$('[data-cl-mode]').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            classicalQuizMode = this.dataset.clMode;
            if (classicalQuizMode === 'dict') {
                $('#classicalDictMode').style.display = '';
                $('#classicalQuizMode').style.display = 'none';
            } else {
                $('#classicalDictMode').style.display = 'none';
                $('#classicalQuizMode').style.display = '';
            }
        });
    });

    // 自测出题
    $('#btnStartQuiz').addEventListener('click', loadClassicalQuiz);
}

async function loadClassical() {
    const keyword = $('#classicalSearch').value.trim();
    const wtype = $('#classicalType').value;
    const listEl = $('#classicalList');
    listEl.innerHTML = '<div class="loading-placeholder">加载中...</div>';
    try {
        const params = new URLSearchParams({ page: classicalPage, per_page: classicalPerPage });
        if (keyword) params.set('q', keyword);
        if (wtype) params.set('type', wtype);
        const resp = await fetch(`/api/classical?${params}`);
        const data = await resp.json();
        if (data.success) {
            $('#classicalInfo').textContent = `共 ${data.total} 条（${data.xuci_count} 虚词 + ${data.shici_count} 实词）`;
            renderClassical(data.words);
            renderClassicalPagination(data.total, data.page, data.per_page);
        }
    } catch (error) {
        listEl.innerHTML = '<div class="empty-placeholder">加载失败</div>';
        console.error('Classical error:', error);
    }
}

function renderClassical(words) {
    if (!words || words.length === 0) {
        $('#classicalList').innerHTML = '<div class="empty-placeholder">未找到相关词条</div>';
        return;
    }
    const html = words.map(item => {
        const typeClass = item.type === '虚词' ? 'classical-type-xuci' : 'classical-type-shici';
        const meaningsBrief = (item.meanings_brief || []).map(m =>
            `<span class="classical-meaning-brief"><span class="cm-usage">${escapeHtml(m.usage)}</span> ${escapeHtml(m.meaning)}</span>`
        ).join('');
        return `
        <div class="classical-card" onclick="showClassicalDetail('${escapeHtml(item.id)}')">
            <div class="classical-card-header">
                <span class="classical-card-word">${escapeHtml(item.word)}</span>
                <span class="classical-card-pinyin">${escapeHtml(item.pinyin || '')}</span>
                <span class="classical-card-type ${typeClass}">${escapeHtml(item.type || '')}</span>
            </div>
            <div class="classical-card-meanings">${meaningsBrief}</div>
            <div class="classical-card-footer">
                <span class="card-detail-link">查看详情 →</span>
            </div>
        </div>
    `;
    }).join('');
    $('#classicalList').innerHTML = html;
}

function renderClassicalPagination(total, page, perPage) {
    const totalPages = Math.ceil(total / perPage);
    if (totalPages <= 1) {
        $('#classicalPagination').innerHTML = '';
        return;
    }
    let html = '';
    html += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="changeClassicalPage(${page - 1})">上一页</button>`;
    const maxButtons = 5;
    let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="changeClassicalPage(${i})">${i}</button>`;
    }
    html += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="changeClassicalPage(${page + 1})">下一页</button>`;
    $('#classicalPagination').innerHTML = html;
}

function changeClassicalPage(page) {
    classicalPage = page;
    loadClassical();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function showClassicalDetail(wordId) {
    try {
        const resp = await fetch(`/api/classical/${wordId}`);
        const data = await resp.json();
        if (data.success) {
            renderClassicalModal(data.word);
        }
    } catch (error) {
        console.error('Classical detail error:', error);
    }
}

function renderClassicalModal(item) {
    const typeClass = item.type === '虚词' ? 'classical-type-xuci' : 'classical-type-shici';

    const meaningsHtml = (item.meanings || []).map((m, i) => {
        const examplesHtml = (m.examples || []).map(ex => `
            <div class="classical-example">
                <div class="ce-sentence">${escapeHtml(ex.sentence || '')}</div>
                <div class="ce-source">—— ${escapeHtml(ex.source || '')}</div>
                ${ex.translation ? `<div class="ce-translation">${escapeHtml(ex.translation)}</div>` : ''}
            </div>
        `).join('');
        return `
            <div class="classical-meaning-item">
                <div class="cm-header">
                    <span class="cm-num-badge">${i + 1}</span>
                    <span class="cm-usage-badge">${escapeHtml(m.usage || '')}</span>
                    <span class="cm-meaning-text">${escapeHtml(m.meaning || '')}</span>
                </div>
                ${examplesHtml ? `<div class="cm-examples">${examplesHtml}</div>` : ''}
            </div>
        `;
    }).join('');

    const html = `
        <div class="detail-word-header">
            <div class="detail-word-main">${escapeHtml(item.word)}</div>
            <div class="detail-word-meta">
                ${item.pinyin ? `<span class="detail-pinyin">${escapeHtml(item.pinyin)}</span>` : ''}
                <span class="type-badge ${typeClass}">${escapeHtml(item.type || '')}</span>
            </div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title">释义与例句</div>
            <div class="classical-meanings">${meaningsHtml}</div>
        </div>
    `;
    $('#modalBody').innerHTML = html;
    $('#modalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
}

// ===== 文言自测 =====
async function loadClassicalQuiz() {
    const qtype = $('#quizType').value;
    const wtype = $('#quizWordType').value;
    const count = $('#quizCount').value;
    const listEl = $('#classicalQuizList');

    listEl.innerHTML = '<div class="loading-placeholder">正在出题...</div>';
    $('#quizResult').style.display = 'none';

    try {
        const params = new URLSearchParams({ count });
        if (qtype) params.set('qtype', qtype);
        if (wtype) params.set('type', wtype);
        const resp = await fetch(`/api/classical/quiz?${params}`);
        const data = await resp.json();
        if (data.success && data.questions.length > 0) {
            classicalQuizQuestions = data.questions;
            renderClassicalQuiz(data.questions);
        } else {
            listEl.innerHTML = `<div class="empty-placeholder">${escapeHtml(data.error || '出题失败')}</div>`;
        }
    } catch (error) {
        listEl.innerHTML = '<div class="empty-placeholder">出题失败，请稍后重试</div>';
        console.error('Quiz error:', error);
    }
}

function renderClassicalQuiz(questions) {
    if (!questions || questions.length === 0) {
        $('#classicalQuizList').innerHTML = '<div class="empty-placeholder">暂无题目</div>';
        return;
    }

    const html = questions.map((q, i) => {
        const optionsHtml = q.options.map((opt, j) => `
            <label class="quiz-option" data-qindex="${i}" data-oindex="${j}">
                <input type="radio" name="quiz-q${i}" value="${j}" onchange="checkQuizAnswer(${i})">
                <span class="quiz-option-label">${String.fromCharCode(65 + j)}. ${escapeHtml(opt)}</span>
            </label>
        `).join('');

        const exampleHtml = q.example_sentence ? `
            <div class="quiz-example">
                <div class="qe-sentence">${escapeHtml(q.example_sentence)}</div>
                ${q.example_source ? `<div class="qe-source">—— ${escapeHtml(q.example_source)}</div>` : ''}
            </div>
        ` : '';

        return `
        <div class="quiz-item" data-index="${i}">
            <div class="quiz-item-header">
                <span class="quiz-num">第 ${i + 1} 题</span>
                <span class="quiz-type-badge">${escapeHtml(q.type_label)}</span>
                ${q.word ? `<span class="quiz-word-tag">${escapeHtml(q.word)}（${escapeHtml(q.word_type)}）</span>` : ''}
            </div>
            <div class="quiz-question">${escapeHtml(q.question)}</div>
            ${exampleHtml}
            <div class="quiz-options">${optionsHtml}</div>
            <div class="quiz-feedback" id="quiz-feedback-${i}"></div>
        </div>
    `;
    }).join('');

    // 添加提交按钮
    const submitHtml = `
        <div class="quiz-submit-area">
            <button class="btn btn-primary btn-lg" id="btnSubmitQuiz" onclick="submitQuiz()">提交答卷</button>
        </div>
    `;

    $('#classicalQuizList').innerHTML = html + submitHtml;
}

function checkQuizAnswer(index) {
    const question = classicalQuizQuestions[index];
    if (!question) return;

    const selected = document.querySelector(`input[name="quiz-q${index}"]:checked`);
    if (!selected) return;

    const selectedIndex = parseInt(selected.value);
    const feedback = $(`#quiz-feedback-${index}`);
    const options = document.querySelectorAll(`.quiz-option[data-qindex="${index}"]`);

    if (selectedIndex === question.correct_index) {
        feedback.innerHTML = '<span class="feedback-correct">✓ 正确！</span>';
        feedback.className = 'quiz-feedback feedback-show correct';
        options[selectedIndex].classList.add('option-correct');
    } else {
        feedback.innerHTML = `
            <span class="feedback-wrong">✗ 不正确</span>
            <div class="feedback-answer">正确答案：${String.fromCharCode(65 + question.correct_index)}. ${escapeHtml(question.options[question.correct_index])}</div>
            <div class="feedback-explanation">${escapeHtml(question.explanation || '')}</div>
        `;
        feedback.className = 'quiz-feedback feedback-show wrong';
        options[selectedIndex].classList.add('option-wrong');
        options[question.correct_index].classList.add('option-correct');
    }

    // 禁用已选选项
    options.forEach(opt => {
        const input = opt.querySelector('input');
        if (input && !input.checked) {
            // 允许继续选择（不锁定），但标记已答
        }
    });
}

function submitQuiz() {
    let correct = 0;
    let answered = 0;

    classicalQuizQuestions.forEach((q, i) => {
        const selected = document.querySelector(`input[name="quiz-q${i}"]:checked`);
        if (selected) {
            answered++;
            if (parseInt(selected.value) === q.correct_index) {
                correct++;
            } else {
                // 如果还没显示反馈，显示
                const feedback = $(`#quiz-feedback-${i}`);
                if (!feedback.classList.contains('feedback-show')) {
                    checkQuizAnswer(i);
                }
            }
        }
    });

    const resultEl = $('#quizResult');
    const scoreEl = $('#quizScore');
    const detailEl = $('#quizDetail');

    if (answered > 0) {
        const score = Math.round((correct / classicalQuizQuestions.length) * 100);
        scoreEl.textContent = `得分：${score} 分`;
        detailEl.textContent = `答对 ${correct} / ${classicalQuizQuestions.length} 题（已答 ${answered} 题）`;
        resultEl.style.display = 'block';
        resultEl.scrollIntoView({ behavior: 'smooth' });
    } else {
        alert('请先答题再提交！');
    }
}

// ===== 弹窗（原有） =====
function renderWordModal(item) {
    const sentimentClass = getSentimentClass(item.sentiment);
    const sourceBadge = item.source === 'online'
        ? '<span class="source-badge online">在线查询</span>'
        : '';
    const examplesHtml = (item.examples || []).map(ex => `
        <div class="detail-example">${escapeHtml(ex)}</div>
    `).join('');

    const html = `
        <div class="detail-word-header">
            <div class="detail-word-main">${escapeHtml(item.word)}</div>
            <div class="detail-word-meta">
                ${item.pinyin ? `<span class="detail-pinyin">${escapeHtml(item.pinyin)}</span>` : ''}
                <span class="type-badge">${escapeHtml(item.type || '')}</span>
                <span class="sentiment-badge ${sentimentClass}">${escapeHtml(item.sentiment || '')}</span>
                ${sourceBadge}
            </div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title">释义</div>
            <div class="detail-content">${escapeHtml(item.meaning || '')}</div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title">适用语境</div>
            <div class="detail-context">${escapeHtml(item.context || '')}</div>
        </div>
        ${examplesHtml ? `
            <div class="detail-section">
                <div class="detail-section-title">例句</div>
                <div class="detail-examples">${examplesHtml}</div>
            </div>
        ` : ''}
    `;
    $('#modalBody').innerHTML = html;
    $('#modalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    $('#modalOverlay').classList.remove('active');
    document.body.style.overflow = '';
}

// ============================================================
// 改病句 / 找错别字 板块
// ============================================================

function renderTypeCards(containerId, types, quizHandler) {
    const box = $(containerId);
    if (!types.length) {
        box.innerHTML = '<div class="loading-placeholder">暂无常考类型数据</div>';
        return;
    }
    box.innerHTML = types.map((t, i) => `
        <div class="type-card">
            <div class="type-card-header">
                <span class="type-card-name">${escapeHtml(t.name)}</span>
                <span class="type-card-freq">${escapeHtml(t.freq || '')}</span>
            </div>
            <div class="type-card-desc">${escapeHtml(t.desc || '')}</div>
            <div class="type-card-example"><b>例：</b>${escapeHtml(t.example || '')}</div>
            <div class="type-card-tip"><b>技巧：</b>${escapeHtml(t.tip || '')}</div>
        </div>
    `).join('');
}

// ---------- 改病句 ----------
async function startSentenceQuiz() {
    try {
        const res = await fetch('/api/sentence/quiz?count=3');
        const data = await res.json();
        const list = $('#sentenceQuizList');
        $('#sentenceQuizArea').style.display = '';
        if (!data.success || !data.questions.length) {
            list.innerHTML = '<div class="loading-placeholder">题库为空</div>';
            return;
        }
        list.innerHTML = data.questions.map((q, idx) => {
            const context = (q.context || '').replace(/^（\d{4}[^）]*）/, '');
            return `
            <div class="quiz-item" data-idx="${idx}">
                <div class="quiz-item-num">第 ${idx + 1} 题 <span class="quiz-item-tag">${escapeHtml((q.error_types || []).join(' / '))}</span></div>
                ${q.requirement ? `<div class="sentence-requirement">【要求】${escapeHtml(q.requirement)}</div>` : ''}
                <div class="sentence-context">${escapeHtml(context)}</div>
                <div class="quiz-actions">
                    <button class="btn btn-secondary btn-reveal" data-idx="${idx}">查看参考答案</button>
                </div>
                <div class="quiz-answer" id="sentenceAnswer${idx}" style="display:none;">
                    <div class="quiz-answer-main"><b>参考答案：</b>${escapeHtml(q.answer || '')}</div>
                    ${q.analysis ? `<div class="quiz-analysis"><b>解析：</b>${escapeHtml(q.analysis)}</div>` : ''}
                </div>
            </div>`;
        }).join('');
        list.querySelectorAll('.btn-reveal').forEach(btn => {
            btn.addEventListener('click', () => {
                const ans = $('#sentenceAnswer' + btn.dataset.idx);
                ans.style.display = ans.style.display === 'none' ? '' : 'none';
                btn.textContent = ans.style.display === 'none' ? '查看参考答案' : '收起答案';
            });
        });
    } catch (e) {
        console.error(e);
    }
}

function initSentenceErrors() {
    fetch('/api/sentence/info').then(r => r.json()).then(data => {
        if (data.success) {
            renderTypeCards('#sentenceTypes', data.types);
            $('#btnSentenceQuiz').textContent = `开始自测（题库 ${data.count} 题）`;
        }
    });
    $('#btnSentenceQuiz').addEventListener('click', () => {
        $('#sentenceQuizArea').style.display = '';
        startSentenceQuiz();
        $('#sentenceQuizArea').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    $('#btnSentenceNext').addEventListener('click', startSentenceQuiz);
}

// ---------- 找错别字 ----------
let typoAnswered = 0, typoCorrect = 0, typoTotal = 0;

async function startTypoQuiz() {
    try {
        const res = await fetch('/api/typo/quiz?count=3');
        const data = await res.json();
        const list = $('#typoQuizList');
        $('#typoQuizArea').style.display = '';
        typoAnswered = 0; typoCorrect = 0;
        if (!data.success || !data.questions.length) {
            list.innerHTML = '<div class="loading-placeholder">题库为空</div>';
            return;
        }
        typoTotal = data.questions.length * 4;
        updateTypoScore();
        list.innerHTML = data.questions.map((q, idx) => `
            <div class="quiz-item" data-idx="${idx}">
                <div class="quiz-item-num">第 ${idx + 1} 题 <span class="quiz-item-tag">语段找错</span></div>
                <div class="sentence-requirement">【要求】${escapeHtml(q.requirement || '文段中有四个错别字，请全部找出并改正。')}</div>
                <div class="sentence-context">${escapeHtml(q.context || '')}</div>
                <div class="typo-fill-grid">
                    ${[0, 1, 2, 3].map(i => `
                        <div class="typo-fill-row" data-row="${i}">
                            <span class="typo-fill-label">第${['一', '二', '三', '四'][i]}处</span>
                            <input class="typo-input typo-input-wrong" type="text" placeholder="错别字" maxlength="8" autocomplete="off">
                            <span class="typo-fill-arrow">→</span>
                            <input class="typo-input typo-input-right" type="text" placeholder="改正为" maxlength="8" autocomplete="off">
                            <span class="typo-fill-mark"></span>
                        </div>`).join('')}
                </div>
                <div class="quiz-actions">
                    <button class="btn btn-secondary btn-typo-check" data-idx="${idx}">核对答案</button>
                </div>
                <div class="quiz-answer" id="typoAnalysis${idx}" style="display:none;">
                    <div class="quiz-answer-main"><b>参考答案：</b>${(q.answer || []).map(a => `“${escapeHtml(a.wrong)}”改为“${escapeHtml(a.right)}”`).join('；')}</div>
                    <div class="quiz-analysis"><b>解析：</b>${escapeHtml(q.analysis || '')}</div>
                </div>
            </div>`
        ).join('');
        list.querySelectorAll('.btn-typo-check').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = btn.dataset.idx;
                const item = btn.closest('.quiz-item');
                if (item.dataset.done) return;
                item.dataset.done = '1';
                const answers = (data.questions[idx].answer || []).map(a => ({ w: a.wrong, r: a.right, used: false }));
                let correct = 0;
                item.querySelectorAll('.typo-fill-row').forEach(row => {
                    const w = row.querySelector('.typo-input-wrong').value.trim().replace(/\s+/g, '');
                    const r = row.querySelector('.typo-input-right').value.trim().replace(/\s+/g, '');
                    const hit = answers.find(a => !a.used && a.w === w && a.r === r);
                    if (hit) {
                        hit.used = true;
                        correct++;
                        row.classList.add('is-correct');
                        row.querySelector('.typo-fill-mark').textContent = '✓';
                    } else {
                        row.classList.add('is-wrong');
                        row.querySelector('.typo-fill-mark').textContent = '✗';
                    }
                    row.querySelectorAll('input').forEach(inp => inp.disabled = true);
                });
                typoAnswered += 4;
                typoCorrect += correct;
                updateTypoScore();
                btn.disabled = true;
                btn.textContent = `已核对（对 ${correct}/4 处）`;
                $('#typoAnalysis' + idx).style.display = '';
            });
        });
    } catch (e) {
        console.error(e);
    }
}

function updateTypoScore() {
    $('#typoScore').textContent = typoAnswered ? `已核对 ${typoAnswered}/${typoTotal} 处 · 改对 ${typoCorrect} 处` : '';
}

function initTypo() {
    fetch('/api/typo/info').then(r => r.json()).then(data => {
        if (data.success) {
            renderTypeCards('#typoTypes', data.types);
            $('#btnTypoQuiz').textContent = `开始自测（题库 ${data.count} 题）`;
        }
    });
    $('#btnTypoQuiz').addEventListener('click', () => {
        $('#typoQuizArea').style.display = '';
        startTypoQuiz();
        $('#typoQuizArea').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    $('#btnTypoNext').addEventListener('click', startTypoQuiz);
}
