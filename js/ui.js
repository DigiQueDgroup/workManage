const KEY_CLASS = 'currentClass';
const KEY_TASKS_PREFIX = 'cachedTasks_';
const USER_NAME = 'userName';
const DONE_TASKS = 'doneTasks';

let currentClass = localStorage.getItem(KEY_CLASS) || '';
let currentTasks = [];
let existingClasses = []; // 既存のクラス一覧を保持する変数

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
    renderTasks(currentTasks); // 画面を即座に更新
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
    // ユーザー識別データがあるかチェック
    if (!localStorage.getItem(USER_NAME)) {
        showClassSelection(false);
        document.getElementById('username-init-modal').style.display = 'flex';
        return; 
    }
    if (!currentClass) {
        showClassSelection(false);
    } else {
        updateHeader();
        currentTasks = loadCachedTasks(currentClass);
        if (currentTasks.length > 0) {
            renderTasks(currentTasks);
            const statusMsg = document.getElementById('status-msg');
            statusMsg.style.display = 'block';
            const online = await isOnline();
            statusMsg.innerText = online ? '最新データを取得しています...' : 'オフライン中：前回のデータを表示しています';
        }
        loadTasks();
    }
}

/**
 * 初回利用時のユーザー識別コード(userName)生成と保存
 */
function submitInitialUsername() {
    const grade = document.getElementById('init-grade').value;
    const cls = document.getElementById('init-class').value;
    const attendanceNo = document.getElementById('init-attendance').value;
    const school = document.getElementById('init-school').value;

    const finalUserName = grade+cls+attendanceNo+school;
    localStorage.setItem(USER_NAME, finalUserName);

    document.getElementById('username-init-modal').style.display = 'none';
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

// --- クラス選択画面のボタン表示（フィルタリング強化） ---
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
    // ※末尾の R8 は以前の運用ルールに合わせて付与しています
    const normalized = `${grade}-${clsNum}${school}${year}`;

    try {
        // 既存のクラスリスト（existingClasses）から重複を確認
        const isExisting = existingClasses.some(cls => {
            if (!cls) return false;
            // 念のため小文字・空白を揃えて比較
            return String(cls).trim().toLowerCase() === normalized.toLowerCase();
        });

        if (isExisting) {
            // すでに存在する場合は、作成せずそのまま接続
            showNativePopup(`既存のクラス「${normalized}」が見つかりました。接続します。`);
        } else {
            // 存在しない場合は新規作成（旧来の selectClass で作成処理へ）
            showNativePopup(`新規クラス「${normalized}」を作成します。`);
        }
        
        // 最終的な接続処理
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
        renderTasks(currentTasks);
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
            // 課題進捗用のキャッシュで古いものを削除
            cleanupDoneTasks(currentTasks);
            
            if (currentTasks.length === 0) {
                statusMsg.innerText = '現在、課題はありません。';
                container.innerHTML = '';
            } else {
                statusMsg.style.display = 'none';
                renderTasks(currentTasks);
            }
        } else {
            statusMsg.innerText = 'データエラー: ' + result.status;
        }
    } catch (error) {
        if (cachedTasks.length > 0) {
            statusMsg.innerHTML = `データ取得に失敗しました。前回のキャッシュを表示します。<br><small>${error.message}</small>`;
            renderTasks(cachedTasks);
        } else {
            statusMsg.innerHTML = `取得に失敗しました。<br><small>${error.message}</small>`;
        }
    }
}

// 課題のデータを表示
function renderTasks(tasks) {
    const container = document.getElementById('task-list');
    container.innerHTML = '';
    const doneList = getDoneTasks();

    // 空のオブジェクトや、ID・教科・課題名がすべて空の無効なデータを弾く
    const validTasks = tasks.filter(task => task && (task.課題id || task.教科 || task.課題名));
    // 有効な課題が1つもない場合はメッセージを表示してカード作成を終了する
    if (validTasks.length === 0) {
        const statusMsg = document.getElementById('status-msg');
        if (statusMsg) {
            statusMsg.style.display = 'block';
            statusMsg.innerText = '現在、課題はありません。';
        }
        return;
    }

    validTasks.forEach(task => {
        const isDone = doneList.includes(getTaskFingerprint(task));
    
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

    // 0.5秒間、新しい操作を受け付けないようにする
    isModalClosing = true;
    setTimeout(() => {
        isModalClosing = false;
    }, 500); // 500ミリ秒 = 0.5秒
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
    const subject = document.getElementById('add-subject').value.trim();
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

    // localStorageからuserNameを取得
    const storedUsername = localStorage.getItem(USER_NAME);
    if (!storedUsername) {
        showNativePopup('ユーザー情報が消えています。再設定してください。');
        init(); // 再度モーダルを出すためにinitを呼ぶ
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
            username: storedUsername
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
            const payload = { action: 'delete', className: currentClass, id: id };

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

// --- 追加: 更新処理（ui.jsの末尾などへ） ---
async function refreshTasks() {
    const icon = document.querySelector('.refresh-icon');
    // アイコンを回転させるアニメーションクラスを付与
    icon.classList.add('spinning');
    
    try {
        await loadTasks(); // 既存のデータ取得関数を実行
    } finally {
        // 0.5秒後にアニメーションクラスを除去（回転を止める）
        setTimeout(() => {
            icon.classList.remove('spinning');
        }, 500);
    }
}

// --- モーダルの背景クリックで閉じる ---
const handleOutsideClick = (event) => {
    const detailModal = document.getElementById('detail-modal');
    const addModal = document.getElementById('add-modal');

    // event.target（実際に触れた要素）が、モーダルの背景要素そのものであるか判定
    if (event.target === detailModal || event.target === addModal) {
        closeModals();
    }
};
//通常のクリック
window.addEventListener('click',handleOutsideClick);
window.addEventListener('touchstart', handleOutsideClick, { passive: true });

window.addEventListener('DOMContentLoaded', init);
