const KEY_CLASS = 'currentClass';
const KEY_TASKS_PREFIX = 'cachedTasks_';
const USER_NAME = 'userName';
const DONE_TASKS = 'doneTasks';

let currentClass = localStorage.getItem(KEY_CLASS) || '';
let currentTasks = [];
let existingClasses = []; // 既存のクラス一覧を保持する変数
let userName = localStorage.getItem(USER_NAME) || '';

let calendar = null; // FullCalendarのインスタンスを保持する変数
let currentViewMode = 'list'; // 現在の表示モードを管理 ('list' または 'calendar')

let isModalClosing = false;

// オフライン検知を改善する関数
async function isOnline() {
    if (!navigator.onLine) return false;
    try {
        // 小さなリクエストで実際の接続を確認
        const response = await fetch('./icon/icon-192.jpg', { method: 'HEAD', cache: 'no-cache', signal: AbortSignal.timeout(3000) });
        return response.ok;
    } catch {
        return false;
    }
}

function loadCachedTasks(className) {
    try {
        const raw = localStorage.getItem(KEY_TASKS_PREFIX+className);
        if (!raw) return [];
        const cached = JSON.parse(raw);
        return Array.isArray(cached) ? cached : [];
    } catch (e) {
        console.warn('cachedTasks読み込み失敗', e);
        return [];
    }
}

function saveCachedTasks(className, tasks) {
    try {
        localStorage.setItem(KEY_TASKS_PREFIX + className, JSON.stringify(tasks));
    } catch (e) {
        console.warn('cachedTasks保存失敗', e);
    }
}

// 課題を一意に特定する指紋（ID+教科+課題名+期限）
function getTaskFingerprint(task) {
    const deadline = task.期限 ? new Date(task.期限).getTime() : 'no-deadline';
    return `${task.課題id}-${task.教科}-${task.課題名}-${deadline}`;
}

// 完了リストの取得
function getDoneTasks() {
    return JSON.parse(localStorage.getItem(DONE_TASKS) || '[]');
}

/**
 * 現在存在しない課題の完了キャッシュを削除する
 * @param {Array} latestTasks - サーバーから取得した最新の課題リスト
 */
function cleanupDoneTasks(latestTasks) {
    const doneList = getDoneTasks();
    if (doneList.length === 0) return;

    // 最新の課題リストから、存在するすべての指紋を取得
    const validFingerprints = latestTasks.map(task => getTaskFingerprint(task));

    // 今の完了リストの中で「最新リストに存在するもの」だけを残す
    const cleanedList = doneList.filter(fingerprint => validFingerprints.includes(fingerprint));

    // ストレージを更新
    localStorage.setItem(DONE_TASKS, JSON.stringify(cleanedList));
    console.log(`キャッシュを整理しました。保持中: ${cleanedList.length}件`);
}

// ステータス切り替え（ボタンから直接呼ばれる）
function toggleTaskStatus(event, taskId) {
    event.stopPropagation(); // 詳細画面が開くのを防ぐ

    const task = currentTasks.find(t => t.課題id == taskId);
    if (!task) return;

    const fingerprint = getTaskFingerprint(task);
    let doneList = getDoneTasks();

    if (doneList.includes(fingerprint)) {
        doneList = doneList.filter(f => f !== fingerprint);
    } else {
        doneList.push(fingerprint);
    }

    localStorage.setItem(DONE_TASKS, JSON.stringify(doneList));
    renderTasks(); // 画面を即座に更新 (フィルター適用)
    if (currentViewMode === 'calendar') renderCalendar(); // カレンダー表示中ならカレンダーも更新
}

function showNativePopup(message, options = {}) {
    const popup = document.getElementById('native-popup');
    const messageEl = document.getElementById('native-popup-message');
    const actions = document.getElementById('native-popup-actions');

    messageEl.innerText = message;
    actions.innerHTML = '';
    popup.classList.add('active');

    if (options.type === 'confirm') {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel';
        cancelBtn.innerText = options.cancelText || 'キャンセル';
        cancelBtn.onclick = () => {
            closeNativePopup();
            if (typeof options.onCancel === 'function') options.onCancel();
        };

        const confirmBtn = document.createElement('button');
        confirmBtn.innerText = options.confirmText || 'OK';
        confirmBtn.onclick = () => {
            closeNativePopup();
            if (typeof options.onConfirm === 'function') options.onConfirm();
        };

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
    } else {
        const okBtn = document.createElement('button');
        okBtn.innerText = options.okText || '閉じる';
        okBtn.onclick = () => {
            closeNativePopup();
            if (typeof options.onClose === 'function') options.onClose();
        };
        actions.appendChild(okBtn);
    }
}

function closeNativePopup() {
    const popup = document.getElementById('native-popup');
    popup.classList.remove('active');
}

// --- 初期化 ---
async function init() {
    // 特設リストモーダル用のHTML要素が存在しない場合は動的に追加
    createDateTasksModalElement();

    // ユーザー識別データがあるかチェック
    if (!userName) {
        showClassSelection(false);
        document.getElementById('username-init-modal').style.display = 'flex';
        return;
    }
    // クラスの選択情報があるかチェック
    if (!currentClass) {
        showClassSelection(false);
    } else {
        updateHeader();
        currentTasks = loadCachedTasks(currentClass);
        if (currentTasks.length > 0) {
            initFilterUI(); // キャッシュがある場合は先にフィルターUIを初期化して描画
            const statusMsg = document.getElementById('status-msg');
            statusMsg.style.display = 'block';
            const online = await isOnline();
            statusMsg.innerText = online ? '最新データを取得しています...' : 'オフライン中：前回のデータを表示しています';
        }
        loadTasks();
    }
}

// --- 追加: 科目セレクトボックスの挙動制御 ---
document.addEventListener('DOMContentLoaded', () => {
    const subjectSelect = document.getElementById('add-subject');
    const customSubjectGroup = document.getElementById('custom-subject-group');
    
    if (subjectSelect && customSubjectGroup) {
        subjectSelect.addEventListener('change', () => {
            if (subjectSelect.value === 'その他') {
                customSubjectGroup.style.display = 'block';
            } else {
                customSubjectGroup.style.display = 'none';
                document.getElementById('add-custom-subject').value = ''; // リセット
            }
        });
    }
});

/**
 * 初回利用時のユーザー識別コード(userName)生成と保存
 */
function submitInitialUsername() {
    const grade = document.getElementById('init-grade').value;
    const cls = document.getElementById('init-class').value;
    const attendanceNo = document.getElementById('init-attendance').value;
    const school = document.getElementById('init-school').value;

    userName = grade+cls+attendanceNo+school;
    localStorage.setItem(USER_NAME, userName);

    document.getElementById('username-init-modal').style.display = 'none';

    init();
}

// クラスリストのみを取得して変数に格納する内部関数
async function fetchClassListOnly() {
    try {
        const data = await apiGetClassList();
        existingClasses = data.classes || [];
        return existingClasses;
    } catch (e) {
        console.error("クラスリストの取得に失敗しました", e);
        return existingClasses;
    }
}

// --- クラス選択画面 of ボタン表示（フィルタリング強化） ---
function updateClassSelectionButtons() {
    const btnContainer = document.getElementById('class-list-buttons');
    btnContainer.innerHTML = '';

    if (existingClasses.length > 0) {
        existingClasses.forEach(cls => {
            const clsStr = String(cls);
            
            // 除外条件:
            // 1. 特定の名前のシート
            // 2. 空白データ
            // 3. 日付形式（2026-03... のようなISO文字列）を除外
            const isSystemSheet = ['クラスリスト', '課題リストテンプレート', 'スクリプトログ'].includes(clsStr);
            const isIsoDate = /^\d{4}-\d{2}-\d{2}/.test(clsStr); // 日付形式の正規表現チェック

            if (isSystemSheet || !clsStr.trim() || isIsoDate) return;

            const btn = document.createElement('button');
            btn.className = 'class-btn';
            btn.innerText = clsStr;
            btn.onclick = () => selectClass(clsStr);
            btnContainer.appendChild(btn);
        });
    } else {
        btnContainer.innerHTML = '<p>既存のクラスはありません</p>';
    }
}

function updateHeader() {
    document.getElementById('header-class-name').innerHTML = `${currentClass || '未設定'}<br>課題リスト`;
}

// --- クラス選択関連 ---
async function showClassSelection(canCancel = true) {
    const ui = document.getElementById('class-selection-ui');
    const loading = document.getElementById('loading-ui');
    const container = document.getElementById('class-selection-container');
    const cancelBtn = document.getElementById('close-selection-btn');

    ui.style.display = 'flex';
    loading.style.display = 'flex';
    container.style.display = 'none';
    cancelBtn.style.display = canCancel ? 'inline-block' : 'none';

    const btnContainer = document.getElementById('class-list-buttons');
    btnContainer.innerHTML = '';

    // セレクトボックスとボタンの要素を取得
    const gradeSel = document.getElementById('new-class-grade');
    const classSel = document.getElementById('new-class-class');
    const schoolSel = document.getElementById('new-class-school');
    const createBtn = document.querySelector('.new-class-btn');

    const online = await isOnline();
    if (!online) {
        btnContainer.innerHTML = '<div style="color: #ff6b6b; font-weight: bold; padding: 20px; text-align: center;">現在オフラインのため、クラスを切り替えできません。</div>';
        if (gradeSel) gradeSel.disabled = true;
        if (classSel) classSel.disabled = true;
        if (schoolSel) schoolSel.disabled = true;
        if (createBtn) createBtn.disabled = true;
        
        loading.style.display = 'none';
        container.style.display = 'block';
        showNativePopup('オフライン中はクラス変更できません。');
        return;
    }

    // オンライン時は有効化
    if (gradeSel) gradeSel.disabled = false;
    if (classSel) classSel.disabled = false;
    if (schoolSel) schoolSel.disabled = false;
    if (createBtn) createBtn.disabled = false;

    if (existingClasses.length > 0) {
        updateClassSelectionButtons();
    } else {
        btnContainer.innerHTML = '<p>クラス一覧を読み込んでいます...</p>';
    }

    fetchClassListOnly()
        .then(() => {
            updateClassSelectionButtons();
        })
        .catch(() => {
            if (existingClasses.length === 0) {
                btnContainer.innerHTML = '<p>クラス一覧の取得に失敗しました。</p>';
            }
        })
        .finally(() => {
            loading.style.display = 'none';
            container.style.display = 'block';
        });
}


function selectClass(cls) {
    if (!cls) return;
    currentClass = cls;
    localStorage.setItem(KEY_CLASS, currentClass);
    document.getElementById('class-selection-ui').style.display = 'none';
    updateHeader();
    loadTasks();
}

// 学校の年度ベース（令和）を計算して「R8」などの文字列を返すヘルパー関数
function getSchoolYearCode() {
    const now = new Date();
    let year = now.getFullYear();
    const month = now.getMonth() + 1; // 1〜12

    // 1月〜3月は「前年度」扱いにする
    if (month >= 1 && month <= 3) {
        year -= 1;
    }

    // 令和の計算（西暦から2018を引く。2026年なら 2026 - 2018 = 8）
    const reiwaYear = year - 2018;
    return `R${reiwaYear}`;
}

// --- 新規クラス作成（重複チェックとセレクトボックス連携） ---
async function createNewClass() {
    const online = await isOnline();
    if (!online) {
        showNativePopup('オフライン中は新しいクラスを作成できません。');
        return;
    }

    // HTMLのセレクトボックスから値を取得
    const grade = document.getElementById('new-class-grade').value;
    const clsNum = document.getElementById('new-class-class').value;
    const school = document.getElementById('new-class-school').value;
    const year = getSchoolYearCode();
    
    // クラス名の形式を整形 (例: 3-4issR8)
    const normalized = `${grade}-${clsNum}${school}${year}`;

    try {
        // 既存のクラスリスト（existingClasses）から重複を確認
        const isExisting = existingClasses.some(cls => {
            if (!cls) return false;
            return String(cls).trim().toLowerCase() === normalized.toLowerCase();
        });

        if (isExisting) {
            showNativePopup(`既存のクラス「${normalized}」が見つかりました。接続します。`);
        } else {
            showNativePopup(`新規クラス「${normalized}」を作成します。`);
        }
        
        selectClass(normalized);
        
    } catch (e) {
        showNativePopup("処理中にエラーが発生しました: " + e.message);
    }
}


function closeClassSelection() {
    document.getElementById('class-selection-ui').style.display = 'none';
}

function promptClassChange() {
    showClassSelection(true);
}

// --- 課題の読み込みと描画 ---
async function loadTasks() {
    if (!currentClass) {
        await showClassSelection(false);
        return;
    }
    const statusMsg = document.getElementById('status-msg');
    const container = document.getElementById('task-list');
    container.innerHTML = '';
    statusMsg.style.display = 'block';

    const online = await isOnline();
    const cachedTasks = loadCachedTasks(currentClass);
    if (cachedTasks.length > 0) {
        currentTasks = cachedTasks;
        initFilterUI(); // フィルターUIを初期化して描画
        statusMsg.innerText = online ? '最新データを取得しています...' : 'オフライン中：前回のデータを表示しています';
    } else if (!online) {
        statusMsg.innerText = 'オフライン中です。前回のデータがありません。';
        return;
    }

    if (!online) {
        return;
    }

    statusMsg.innerText = 'チョークで書き込み中...';

    try {
        const result = await apiGetTasks(currentClass);

        if (result.status === 'SUCCESS') {
            currentTasks = result.tasks || [];
            saveCachedTasks(currentClass, currentTasks);
            cleanupDoneTasks(currentTasks);
            
            if (currentTasks.length === 0) {
                statusMsg.innerText = '現在、課題はありません。';
                container.innerHTML = '';
                if (calendar) calendar.removeAllEvents();
            } else {
                statusMsg.style.display = 'none';
                initFilterUI(); // 最新データを反映した上でフィルターUIを初期化
                if (currentViewMode === 'calendar') {
                    renderCalendar();
                }
            }
        } else {
            statusMsg.innerText = 'データエラー: ' + result.status;
        }
    } catch (error) {
        if (cachedTasks.length > 0) {
            statusMsg.innerHTML = `データ取得に失敗しました。前回のキャッシュを表示します。<br><small>${error.message}</small>`;
            initFilterUI();
        } else {
            statusMsg.innerHTML = `取得に失敗しました。<br><small>${error.message}</small>`;
        }
    }
}

// 残り時間を計算するヘルパー関数
function getRemainingTime(isoString) {
    if (!isoString) return { text: '', isUrgent: false };
    const deadline = new Date(isoString);
    if (isNaN(deadline.getTime())) return { text: '', isUrgent: false };

    const now = new Date();
    const diffMs = deadline - now;

    if (diffMs <= 0) {
        return { text: '期限切れ', isUrgent: true };
    }

    const totalMinutes = Math.ceil(diffMs / (1000 * 60));

    if (totalMinutes < 60 * 24) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        return { text: `残り ${timeStr}`, isUrgent: true };
    } else {
        const days = Math.floor(totalMinutes / (60 * 24));
        return { text: `残り ${days}日`, isUrgent: false };
    }
}

// 課題のデータを表示 (フィルター考慮)
function renderTasks() {
    const container = document.getElementById('task-list');
    if (!container) return;
    container.innerHTML = '';
    const doneList = getDoneTasks();
    
    // 💡 フィルターが適用された課題のみを取得
    const filteredTasks = getFilteredTasks();
    
    const validTasks = filteredTasks.filter(task => task && (task.課題id || task.教科 || task.課題名));
    if (validTasks.length === 0) {
        const statusMsg = document.getElementById('status-msg');
        if (statusMsg && currentTasks.length > 0) {
            container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #888; font-weight: bold;">選択した科目の課題はありません。</div>';
        } else if (statusMsg) {
            statusMsg.style.display = 'block';
            statusMsg.innerText = '現在、課題はありません。';
        }
        return;
    }

    validTasks.forEach(task => {
        const isDone = doneList.includes(getTaskFingerprint(task));
        const remaining = getRemainingTime(task.期限);
    
        const card = document.createElement('div');
        card.className = 'task-card';
        card.onclick = () => openDetailModal(task.課題id);

        card.innerHTML = `
            <button class="status-toggle-btn ${isDone ? 'is-done' : ''}" 
                    onclick="toggleTaskStatus(event, '${task.課題id}')">
                ${isDone ? '完了' : '未完了'}
            </button>

            <div class="subject">${task.教科 || "不明"}</div>
            
            <div class="title">${task.課題名 || "無題の課題"}</div>
            
            <div class="detail-badge">${task.詳細 || "==詳細なし=="}</div>
            
            <div class="task-footer">
                <div class="time-left ${remaining.isUrgent ? 'urgent' : ''}">${remaining.text}</div>
                <div class="deadline">${formatDateTime(task.期限)}</div>
            </div>
        `;
        container.appendChild(card);
    });
}

/* --- モーダル制御 --- */
function closeModals() {
    document.getElementById('add-modal').style.display = 'none';
    document.getElementById('detail-modal').style.display = 'none';
    
    const dateTasksModal = document.getElementById('date-tasks-modal');
    if (dateTasksModal) {
        dateTasksModal.classList.remove('show');
        setTimeout(() => {
            dateTasksModal.style.display = 'none';
        }, 150);
    }

    isModalClosing = true;
    setTimeout(() => {
        isModalClosing = false;
    }, 500);
}

async function openAddModal() {
    if (isModalClosing) return;
    const online = await isOnline();
    if (!online) {
        showNativePopup('オフライン中は課題の追加ができません。');
        return;
    }
    if (!currentClass) {
        showNativePopup('先にクラスを設定してください。');
        promptClassChange();
        return;
    }
    document.getElementById('add-subject').value = '';
    document.getElementById('add-title').value = '';
    document.getElementById('add-detail').value = '';
    document.getElementById('add-deadline').value = '';

    // 💡 修正: モーダルを開くたびにカスタム入力欄を非表示かつ空文字にリセット
    document.getElementById('add-custom-subject').value = '';
    document.getElementById('custom-subject-group').style.display = 'none';

    document.getElementById('add-modal').style.display = 'flex';
}

function openDetailModal(id) {
    if (isModalClosing) return;
    const task = currentTasks.find(t => t.課題id === id);
    if (!task) return;

    document.getElementById('detail-subject').innerText = task.教科 || "不明";
    document.getElementById('detail-title').innerText = task.課題名 || "無題の課題";
    document.getElementById('detail-desc').innerText = task.詳細 || "詳細なし";
    document.getElementById('detail-deadline').innerText = "期限: " + formatDateTime(task.期限);
    document.getElementById('detail-delete-btn').onclick = () => confirmDelete(id);
    document.getElementById('detail-modal').style.display = 'flex';
}

// --- 登録・削除アクション ---
async function submitTask() {
    // 💡 修正: セレクトボックスの値が「その他」だった場合は、テキストエリアの値を取得する
    let subject = document.getElementById('add-subject').value;
    if (subject === 'その他') {
        subject = document.getElementById('add-custom-subject').value.trim();
    } else {
        subject = subject ? subject.trim() : '';
    }

    const title = document.getElementById('add-title').value.trim();
    const detail = document.getElementById('add-detail').value.trim();
    const deadlineRaw = document.getElementById('add-deadline').value;

    const online = await isOnline();
    if (!online) {
        showNativePopup('オフライン中は課題の追加ができません。');
        return;
    }
    if (!subject || !title || !deadlineRaw) {
        showNativePopup('科目名、課題名、期限は必須です。');
        return;
    }

    if (!userName) {
        showNativePopup('ユーザー情報が消えています。再設定してください。');
        init();
        return;
    }

    const d = new Date(deadlineRaw);
    const formattedDeadline = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
    const payload = {
        action: 'add',
        className: currentClass,
        task: { 
            subject: subject, 
            title: title, 
            detail: detail, 
            deadline: formattedDeadline, 
            username: userName
        }
    };

    try {
        closeModals();
        document.getElementById('status-msg').style.display = 'block';
        document.getElementById('status-msg').innerText = "追加処理中...";
        
        const result = await apiAddTask(payload);
        if (result.status === 'SUCCESS') {
            loadTasks();
        } else {
            showNativePopup("追加エラー: " + result.status);
            document.getElementById('status-msg').style.display = 'none';
        }
    } catch (e) {
        showNativePopup("通信エラー: " + e.message);
        document.getElementById('status-msg').style.display = 'none';
    }
}

async function confirmDelete(id) {
    const online = await isOnline();
    if (!online) {
        showNativePopup('オフライン中は課題の削除ができません。');
        return;
    }

    showNativePopup('本当にこの課題を削除しますか？', {
        type: 'confirm',
        confirmText: '削除する',
        cancelText: 'キャンセル',
        onConfirm: async () => {
            closeModals();
            const payload = {
                action: 'delete',
                className: currentClass,
                id: id,
                userName: userName
            };

            try {
                document.getElementById('status-msg').style.display = 'block';
                document.getElementById('status-msg').innerText = '削除処理中...';
                const result = await apiDeleteTask(payload);
                if (result.status === 'SUCCESS') {
                    loadTasks();
                } else {
                    showNativePopup('削除エラー: ' + result.status);
                    document.getElementById('status-msg').style.display = 'none';
                }
            } catch (e) {
                showNativePopup('通信エラー: ' + e.message);
                document.getElementById('status-msg').style.display = 'none';
            }
        }
    });
}

function formatDateTime(isoString) {
    if (!isoString) return "--/-- --:--";
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return String(isoString);
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function refreshTasks() {
    const icon = document.querySelector('.refresh-icon');
    if (icon) icon.classList.add('spinning');
    
    try {
        await loadTasks();
    } finally {
        setTimeout(() => {
            if (icon) icon.classList.remove('spinning');
        }, 500);
    }
}

// --- リスト表示とカレンダー表示の切り替え ---
function switchView(mode) {
    currentViewMode = mode;
    const listView = document.getElementById('task-list');
    const calendarView = document.getElementById('calendar-view');
    const btnList = document.getElementById('btn-list-view');
    const btnCalendar = document.getElementById('btn-calendar-view');

    if (mode === 'calendar') {
        if (listView) listView.style.display = 'none';
        if (calendarView) calendarView.style.display = 'block';
        if (btnList) btnList.classList.remove('active');
        if (btnCalendar) btnCalendar.classList.add('active');
        
        renderCalendar();
    } else {
        if (listView) listView.style.display = ''; // 本来のgrid表示に戻す
        if (calendarView) calendarView.style.display = 'none';
        if (btnList) btnList.classList.add('active');
        if (btnCalendar) btnCalendar.classList.remove('active');
    }
}

// --- 追加: 「特設リストモーダル(2段構え)」用HTMLと専用スタイルの動的生成 ---
function createDateTasksModalElement() {
    // 既にスタイルがあれば何もしない
    if (document.getElementById('date-tasks-style')) return;

    // 💡 特設モーダル専用のCSSを定義して適用する
    const style = document.createElement('style');
    style.id = 'date-tasks-style';
    style.innerHTML = `
        #date-tasks-modal {
            display: none;
            position: fixed;
            z-index: 9999 !important; /* 既存モーダルより最前面に配置 */
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.6) !important;
            justify-content: center;
            align-items: center;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        #date-tasks-modal.show {
            display: flex !important;
            opacity: 1;
        }
        #date-tasks-modal .modal-content {
            background-color: #ffffff;
            border-radius: 12px;
            width: 90%;
            max-width: 400px;
            padding: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            transform: translateY(-20px);
            transition: transform 0.2s ease;
            color: #333333;
        }
        #date-tasks-modal.show .modal-content {
            transform: translateY(0);
        }
        /* 曜日ヘッダーリンクの強制表示設定 */
        .fc .fc-col-header-cell-cushion {
            text-decoration: none !important;
        }
        /* 日付セル自体に指カーソルを設定 */
        .fc .fc-daygrid-day {
            cursor: pointer !important;
        }
    `;
    document.head.appendChild(style);
}

// 特定の日付の課題一覧モーダルを開く処理 (2段構えの1段目 - フィルター考慮)
function openDateTasksModal(dateStr) {
    if (isModalClosing) return;

    // 日付指定をパース
    const targetDate = new Date(dateStr);
    const targetYMD = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

    // フィルター適用済みの課題の中から抽出
    const filtered = getFilteredTasks();
    const targetTasks = filtered.filter(task => {
        if (!task.期限) return false;
        const taskDate = new Date(task.期限);
        if (isNaN(taskDate.getTime())) return false;
        const taskYMD = `${taskDate.getFullYear()}-${String(taskDate.getMonth() + 1).padStart(2, '0')}-${String(taskDate.getDate()).padStart(2, '0')}`;
        return taskYMD === targetYMD;
    });

    const titleEl = document.getElementById('date-tasks-title');
    const containerEl = document.getElementById('date-tasks-container');

    titleEl.innerText = `${targetDate.getMonth() + 1}月${targetDate.getDate()}日の締め切り課題`;
    containerEl.innerHTML = '';

    if (targetTasks.length === 0) {
        containerEl.innerHTML = '<p style="text-align: center; color: #888; padding: 20px; font-size: 0.95rem;">この日の締め切り課題はありません。</p>';
    } else {
        const doneList = getDoneTasks();

        targetTasks.forEach(task => {
            const isDone = doneList.includes(getTaskFingerprint(task));
            const card = document.createElement('div');
            card.style.cssText = `
                background: #f8f9fa;
                border-left: 5px solid ${isDone ? '#868e96' : '#228be6'};
                border-radius: 6px;
                padding: 12px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                transition: transform 0.1s ease;
            `;
            
            card.onmouseenter = () => card.style.transform = 'scale(1.01)';
            card.onmouseleave = () => card.style.transform = 'scale(1)';

            card.onclick = (e) => {
                e.stopPropagation();
                document.getElementById('date-tasks-modal').classList.remove('show');
                document.getElementById('date-tasks-modal').style.display = 'none';
                openDetailModal(task.課題id);
            };

            card.innerHTML = `
                <div style="flex: 1; min-width: 0; text-align: left;">
                    <div style="font-size: 0.8rem; font-weight: bold; color: #888; margin-bottom: 2px;">${task.教科 || '不明'}</div>
                    <div style="font-size: 0.95rem; font-weight: bold; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; ${isDone ? 'text-decoration: line-through; color: #aaa;' : ''}">
                        ${task.課題名 || '無題'}
                    </div>
                </div>
                <div style="font-size: 0.8rem; font-weight: bold; background: ${isDone ? '#e9ecef' : '#e7f5ff'}; color: ${isDone ? '#868e96' : '#228be6'}; padding: 4px 10px; border-radius: 12px; white-space: nowrap;">
                    ${isDone ? '完了' : '未完了'}
                </div>
            `;
            containerEl.appendChild(card);
        });
    }

   const modal = document.getElementById('date-tasks-modal');
    modal.style.display = 'flex';
}

// --- カレンダーの描画と課題データのプロット (フィルター考慮) ---
function renderCalendar() {
    const calendarEl = document.getElementById('calendar-view');
    if (!calendarEl) return;

    const doneList = getDoneTasks();

    function getSubjectColor(subject) {
        switch (subject) {
            case '国語':     return '#ff6b6b';
            case '数学':     return '#4dadf7';
            case '英語':     return '#51cf66';
            case '地理総合': return '#fcc419';
            case 'プロ技':   return '#cc5de8';
            case '情デ':     return '#ff922b';
            case 'コン制':   return '#20c997';
            case '基本情報': return '#339af0';
            case '応用情報': return '#101113';
            case 'ビジマネ': return '#845ef7';
            case '商品開発': return '#ff8787';
            case 'マーケ':   return '#a9e34b';
            default:       return '#868e96';
        }
    }

    // 💡 フィルターが適用された課題のみを取得
    const filteredTasks = getFilteredTasks();

    const events = filteredTasks.map(task => {
        const isDone = doneList.includes(getTaskFingerprint(task));
        const displayTitle = `[${task.教科 || 'その他'}] ${task.課題名 || '無題'}`;
        const backgroundColor = isDone ? 'rgba(255, 255, 255, 0.2)' : getSubjectColor(task.教科);
        
        return {
            id: String(task.課題id),
            title: isDone ? `✅ ${displayTitle}` : displayTitle,
            start: task.期限,
            backgroundColor: backgroundColor,
            borderColor: 'transparent',
            className: isDone ? 'fc-event-done' : '',
            extendedProps: {
                originalId: task.課題id
            }
        };
    });

    if (!calendar) {
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            locale: 'ja',
            dayHeaderFormat: { weekday: 'short' },
            eventDisplay: 'block', 
            displayEventTime: false,
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: ''
            },
            events: events,
            eventClick: function(info) {
                info.jsEvent.preventDefault();
                info.jsEvent.stopPropagation();
                const eventDate = info.event.start;
                openDateTasksModal(eventDate);
            },
            dateClick: function(info) {
                if (info.jsEvent) {
                    info.jsEvent.preventDefault();
                    info.jsEvent.stopPropagation();
                }
                openDateTasksModal(info.dateStr);
            },
            dayHeaderDidMount: function(arg) {
                const day = arg.date.getDay();
                const linkEl = arg.el.querySelector('.fc-col-header-cell-cushion');
                if (linkEl) {
                    linkEl.style.setProperty('font-weight', 'bold', 'important');
                    linkEl.style.setProperty('font-size', '1.1rem', 'important');
                    if (day === 0) {
                        linkEl.style.setProperty('color', '#FF0000', 'important');
                    } else if (day === 6) {
                        linkEl.style.setProperty('color', '#0000FF', 'important');
                    } else {
                        linkEl.style.setProperty('color', '#000000', 'important');
                    }
                }
            },
            dayCellDidMount: function(arg) {
                const dayNumberEl = arg.el.querySelector('.fc-daygrid-day-number');
                if (dayNumberEl) {
                    dayNumberEl.style.setProperty('white-space', 'nowrap', 'important');
                    dayNumberEl.style.setProperty('display', 'inline-block', 'important');
                    dayNumberEl.style.setProperty('word-break', 'keep-all', 'important');
                }
            },
            handleWindowResize: true,
            height: 'auto'
        });
        calendar.render();
    } else {
        calendar.removeAllEvents();
        calendar.addEventSource(events);
    }
}

// イベントリスナーの登録
const handleOutsideClick = (event) => {
    const detailModal = document.getElementById('detail-modal');
    const addModal = document.getElementById('add-modal');
    const dateTasksModal = document.getElementById('date-tasks-modal');
    
    if (event.target === detailModal || event.target === addModal || event.target === dateTasksModal) {
        closeModals();
    }
};

// --- 追加: フィルター関連の制御ロジック ---

// フィルター対象となる科目リスト（「その他」以外の既定科目）
const FILTER_SUBJECTS = ["国語", "数学", "英語", "地理総合", "プロ技", "情デ", "コン制", "基本情報", "応用情報", "ビジマネ", "商品開発", "マーケ"];
const STORAGE_KEY_FILTER = "homework_app_filter_settings";

// アコーディオンの開閉を切り替える
function toggleFilterAccordion() {
    const content = document.getElementById('filter-content');
    const arrow = document.getElementById('filter-arrow');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        arrow.style.transform = 'rotate(180deg)';
    } else {
        content.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
    }
}

// フィルター初期化処理 (アプリ起動時に1回呼ぶ)
function initFilterUI() {
    const container = document.getElementById('filter-checkboxes-container');
    if (!container) return;

    container.innerHTML = '';

    // ローカルストレージから保存された設定を読み込む（なければ全て true）
    let savedSettings = {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY_FILTER);
        if (raw) savedSettings = JSON.parse(raw);
    } catch(e) {
        console.error("フィルター設定の読み込みに失敗しました", e);
    }

    FILTER_SUBJECTS.forEach(subject => {
        // デフォルトは true (チェック入り)
        const isChecked = savedSettings[subject] !== false;

        const wrapper = document.createElement('label');
        wrapper.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.9rem;
            cursor: pointer;
            user-select: none;
            padding: 4px 0;
        `;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = subject;
        checkbox.checked = isChecked;
        checkbox.className = 'subject-filter-checkbox';
        checkbox.style.cssText = `
            width: 16px;
            height: 16px;
            cursor: pointer;
        `;

        // チェック変更時に状態を保存＆表示を更新
        checkbox.addEventListener('change', () => {
            saveFilterSettings();
            applyFilters();
        });

        const span = document.createElement('span');
        span.innerText = subject;

        wrapper.appendChild(checkbox);
        wrapper.appendChild(span);
        container.appendChild(wrapper);
    });

    // 初回のフィルタリング適用
    applyFilters();
}

// フィルターの全選択・全解除
function setAllFilters(checked) {
    const checkboxes = document.querySelectorAll('.subject-filter-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checked;
    });
    saveFilterSettings();
    applyFilters();
}

// 現在のチェック状態をLocalStorageに保存する
function saveFilterSettings() {
    const checkboxes = document.querySelectorAll('.subject-filter-checkbox');
    const settings = {};
    checkboxes.forEach(cb => {
        settings[cb.value] = cb.checked;
    });
    localStorage.setItem(STORAGE_KEY_FILTER, JSON.stringify(settings));
}

// フィルターを実際に画面（リスト・カレンダー）に適用する
function applyFilters() {
    // リストとカレンダーを再描画するだけで、getFilteredTasks() を経由して自動的に絞り込まれます
    renderTasks();
    if (currentViewMode === 'calendar') {
        renderCalendar();
    }
}

// フィルター情報を加味して、表示すべき課題データだけを返す便利関数
function getFilteredTasks() {
    const checkboxes = document.querySelectorAll('.subject-filter-checkbox');
    // 起動直後など、チェックボックスがまだ生成されていない場合は全データを返す
    if (checkboxes.length === 0) return currentTasks;

    const activeSubjects = new Set();
    checkboxes.forEach(cb => {
        if (cb.checked) {
            activeSubjects.add(cb.value);
        }
    });

    return currentTasks.filter(task => {
        const subject = task.教科 || "その他";
        // 「その他」は常に表示
        if (subject === "その他" || !FILTER_SUBJECTS.includes(subject)) {
            return true;
        }
        // チェックが入っている科目のみ表示
        return activeSubjects.has(subject);
    });
}

window.addEventListener('click', handleOutsideClick);
window.addEventListener('touchstart', handleOutsideClick, { passive: true });
