/**
 * @file 児童の出席確認 UI（ブラウザ向け）
 * @description HTML / CSS / TypeScript のみ。データは localStorage に保存し、サーバーは不要です。
 */

/** 出席ボード上の列（登園 / 降園 / お休み） */
type AttendanceColumn = "arrival" | "departure" | "holiday";

/** 児童の性別（マグネットの色分けに使用） */
type ChildSex = "male" | "female";

/** 画面上の児童1人分 */
interface Child {
  id: string;
  name: string;
  /** マグネットを置いている列 */
  status: AttendanceColumn;
  /** 性別（男の子: 青 / 女の子: 赤） */
  sex: ChildSex;
}

/** localStorage に保存する JSON の形 */
interface RosterPayload {
  children: Child[];
  /** ヘッダーに表示するクラス名 */
  className: string;
}

/** ドラッグ＆ドロップで児童 ID を渡すときの MIME タイプ */
const DRAG_MIME = "application/x-hoiku-child-id";

/** localStorage に保存するときのキー */
const STORAGE_KEY = "hoiku-attendance-roster-v1";

/** メモリ上の名前一覧とクラス名（画面の唯一の正） */
const state: { children: Child[]; className: string } = { children: [], className: "" };

/** ドラッグ中にハイライトする列 */
let hovered: AttendanceColumn | undefined;

/** スマホ・タブレットで指操作中のマグネット情報 */
let pointerDrag:
  | {
      childId: string;
      ghost: HTMLElement;
      offsetX: number;
      offsetY: number;
      source: HTMLElement;
    }
  | undefined;

/**
 * 児童配列の浅いコピーを作ります（参照共有による意図しない変更を防ぐ）。
 * @param children - コピー元
 */
function clone(children: readonly Child[]): Child[] {
  return children.map((c) => ({ ...c }));
}

/**
 * 新規児童用の一意 ID を発行します（古いブラウザでは簡易 ID にフォールバック）。
 */
function newChildId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 不明な JSON 1件を Child に変換します。不正なら undefined。
 * @param v - localStorage から取り出した1要素
 */
function parseChild(v: unknown): Child | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return undefined;

  const name = o.name.trim();
  if (!name) return undefined;

  const status = normalizeAttendanceStatus(o.status);
  const sex: ChildSex = o.sex === "female" ? "female" : "male";
  return { id: o.id, name, status, sex };
}

/**
 * 保存済みJSONの状態値を、現在の3分類へ正規化します。
 * 旧仕様の present は登園、absent はお休みとして読み替えます。
 * @param value - JSON内の status 値
 * @returns 現在仕様の登園 / 降園 / お休み
 */
function normalizeAttendanceStatus(value: unknown): AttendanceColumn {
  if (value === "arrival" || value === "present") return "arrival";
  if (value === "departure") return "departure";
  if (value === "holiday" || value === "absent") return "holiday";
  return "arrival";
}

/**
 * localStorage の JSON 全体を RosterPayload に正規化します。
 * @param v - パース済み JSON
 */
function parseRoster(v: unknown): RosterPayload {
  const list: unknown =
    Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray((v as Record<string, unknown>).children)
      ? (v as Record<string, unknown>).children
      : [];

  const parsed = (Array.isArray(list) ? list : []).map(parseChild).filter(Boolean) as Child[];

  const deduped: Child[] = [];
  const seen = new Set<string>();
  for (const child of parsed) {
    if (seen.has(child.id)) continue;
    deduped.push(child);
    seen.add(child.id);
  }
  const className =
    v && typeof v === "object" && typeof (v as Record<string, unknown>).className === "string"
      ? ((v as Record<string, unknown>).className as string).trim()
      : "";

  return { children: deduped, className };
}

/**
 * 現在の state を localStorage に書き込みます。
 */
function saveLocal(): void {
  const payload: RosterPayload = { children: clone(state.children), className: state.className };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

/**
 * localStorage から名前一覧を読み込みます。
 * @returns 保存が無い／壊れているときは undefined
 */
function loadLocal(): RosterPayload | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  try {
    return parseRoster(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/**
 * 編集内容を localStorage に保存します。
 */
function persist(): void {
  saveLocal();
}

/**
 * 起動時に localStorage から名前一覧を読み込み、画面を描画します。
 * 保存済みデータが無い場合は空のボードとして開始します。
 */
function loadFromStorage(): void {
  const cached = loadLocal();
  state.children = cached ? clone(cached.children) : [];
  state.className = cached?.className ?? "";
  if (!cached) saveLocal();
  syncClassNameInput();
  render();
}

/** クラス名入力欄を state.className と揃えます。 */
function syncClassNameInput(): void {
  if (elClassName.value !== state.className) {
    elClassName.value = state.className;
  }
}

/**
 * 必須の DOM 要素を取得します。見つからなければ起動時にエラーにします。
 * @param el - querySelector の結果
 * @param name - エラーメッセージ用のセレクタ名
 */
function must<T extends HTMLElement>(el: T | null, name: string): T {
  if (!el) throw new Error(`DOM が見つかりません: ${name}`);
  return el;
}

const elArrivalBody = must(document.querySelector<HTMLDivElement>("#body-arrival"), "#body-arrival");
const elDepartureBody = must(document.querySelector<HTMLDivElement>("#body-departure"), "#body-departure");
const elHolidayBody = must(document.querySelector<HTMLDivElement>("#body-holiday"), "#body-holiday");
const elArrivalCol = must(document.querySelector<HTMLElement>("#column-arrival"), "#column-arrival");
const elDepartureCol = must(document.querySelector<HTMLElement>("#column-departure"), "#column-departure");
const elHolidayCol = must(document.querySelector<HTMLElement>("#column-holiday"), "#column-holiday");
const elArrivalCount = must(document.querySelector<HTMLElement>("#count-arrival"), "#count-arrival");
const elDepartureCount = must(document.querySelector<HTMLElement>("#count-departure"), "#count-departure");
const elHolidayCount = must(document.querySelector<HTMLElement>("#count-holiday"), "#count-holiday");
const elClassName = must(document.querySelector<HTMLInputElement>("#class-name-input"), "#class-name-input");
const btnAdd = must(document.querySelector<HTMLButtonElement>("#btn-add-open"), "#btn-add-open");
const btnDelete = must(document.querySelector<HTMLButtonElement>("#btn-delete-open"), "#btn-delete-open");
const dlgBackdrop = must(document.querySelector<HTMLDivElement>("#dialog-backdrop"), "#dialog-backdrop");
const dlgPanel = must(document.querySelector<HTMLDivElement>("#dialog-panel"), "#dialog-panel");
const dlgName = must(document.querySelector<HTMLInputElement>("#dialog-name-input"), "#dialog-name-input");
const dlgSexMale = must(document.querySelector<HTMLInputElement>("#dialog-sex-male"), "#dialog-sex-male");
const dlgSexFemale = must(document.querySelector<HTMLInputElement>("#dialog-sex-female"), "#dialog-sex-female");
const dlgCancel = must(document.querySelector<HTMLButtonElement>("#btn-dialog-cancel"), "#btn-dialog-cancel");
const dlgOk = must(document.querySelector<HTMLButtonElement>("#btn-dialog-ok"), "#btn-dialog-ok");
const deleteDlgBackdrop = must(document.querySelector<HTMLDivElement>("#delete-dialog-backdrop"), "#delete-dialog-backdrop");
const deleteDlgPanel = must(document.querySelector<HTMLDivElement>("#delete-dialog-panel"), "#delete-dialog-panel");
const deleteDlgName = must(document.querySelector<HTMLInputElement>("#delete-dialog-name-input"), "#delete-dialog-name-input");
const deleteDlgCancel = must(document.querySelector<HTMLButtonElement>("#btn-delete-dialog-cancel"), "#btn-delete-dialog-cancel");
const deleteDlgOk = must(document.querySelector<HTMLButtonElement>("#btn-delete-dialog-ok"), "#btn-delete-dialog-ok");

/**
 * ドラッグ中の列ハイライト（column-active）を更新します。
 */
function paintGlow(): void {
  elArrivalCol.classList.toggle("column-active", hovered === "arrival");
  elDepartureCol.classList.toggle("column-active", hovered === "departure");
  elHolidayCol.classList.toggle("column-active", hovered === "holiday");
}

/**
 * 画面座標から、指やペンが現在重なっている登園/降園/お休み列を判定します。
 * @param x - viewport 上の X 座標
 * @param y - viewport 上の Y 座標
 * @returns 重なっている列。列外の場合は undefined
 */
function getColumnAtPoint(x: number, y: number): AttendanceColumn | undefined {
  const element = document.elementFromPoint(x, y);
  const column = element?.closest<HTMLElement>("[data-attendance-column]");
  const value = column?.dataset.attendanceColumn;
  return value === "arrival" || value === "departure" || value === "holiday" ? value : undefined;
}

/**
 * スマホ・タブレット向けに、指でマグネットをつかんだときの処理を開始します。
 * PC のマウス操作は標準のドラッグ＆ドロップへ任せるため対象外にします。
 * @param ev - pointerdown イベント
 * @param child - 操作対象の児童
 * @param source - 元のマグネット要素
 */
function startPointerDrag(ev: PointerEvent, child: Child, source: HTMLElement): void {
  if (ev.pointerType === "mouse") return;

  ev.preventDefault();
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.classList.add("magnet-ghost");
  ghost.style.width = `${rect.width}px`;
  document.body.appendChild(ghost);

  pointerDrag = {
    childId: child.id,
    ghost,
    offsetX: ev.clientX - rect.left,
    offsetY: ev.clientY - rect.top,
    source,
  };

  source.classList.add("magnet-touch-source");
  source.setPointerCapture(ev.pointerId);
  movePointerGhost(ev.clientX, ev.clientY);
}

/**
 * 指やペンの移動に合わせて、画面上に浮かせたマグネットの見た目を移動します。
 * @param x - viewport 上の X 座標
 * @param y - viewport 上の Y 座標
 */
function movePointerGhost(x: number, y: number): void {
  if (!pointerDrag) return;
  pointerDrag.ghost.style.left = `${x - pointerDrag.offsetX}px`;
  pointerDrag.ghost.style.top = `${y - pointerDrag.offsetY}px`;

  hovered = getColumnAtPoint(x, y);
  paintGlow();
}

/**
 * 指やペンを離したときに、重なっている列へ児童を移動します。
 * 列外で離した場合は何も変更しません。
 * @param x - viewport 上の X 座標
 * @param y - viewport 上の Y 座標
 */
function finishPointerDrag(x: number, y: number): void {
  if (!pointerDrag) return;

  const targetColumn = getColumnAtPoint(x, y);
  const child = state.children.find((item) => item.id === pointerDrag?.childId);

  pointerDrag.ghost.remove();
  pointerDrag.source.classList.remove("magnet-touch-source");
  pointerDrag = undefined;
  hovered = undefined;
  paintGlow();

  if (!targetColumn || !child) return;
  child.status = targetColumn;
  persist();
  render();
}

/**
 * タッチ操作がキャンセルされたときに、浮かせたマグネット表示だけを片付けます。
 */
function cancelPointerDrag(): void {
  if (!pointerDrag) return;
  pointerDrag.ghost.remove();
  pointerDrag.source.classList.remove("magnet-touch-source");
  pointerDrag = undefined;
  hovered = undefined;
  paintGlow();
}

/**
 * state.children の内容に合わせて、登園・降園・お休み列のマグネットと人数を描画し直します。
 */
function render(): void {
  const arrivalKids = state.children.filter((x) => x.status === "arrival");
  const departureKids = state.children.filter((x) => x.status === "departure");
  const holidayKids = state.children.filter((x) => x.status === "holiday");

  renderColumn(elArrivalBody, elArrivalCount, arrivalKids);
  renderColumn(elDepartureBody, elDepartureCount, departureKids);
  renderColumn(elHolidayBody, elHolidayCount, holidayKids);
}

/**
 * 指定列のマグネット一覧と人数表示を更新します。
 * @param body - マグネットを配置する列の本文要素
 * @param countEl - 人数表示要素
 * @param children - この列に表示する児童一覧
 */
function renderColumn(body: HTMLElement, countEl: HTMLElement, children: Child[]): void {
  const fragment = document.createDocumentFragment();
  for (const child of children) fragment.appendChild(makeMagnet(child));
  if (children.length === 0) fragment.appendChild(makeHint("ここにドロップ"));
  body.replaceChildren(fragment);
  countEl.textContent = `${children.length}人`;
}

/**
 * 列が空のときに表示する案内文要素を作ります。
 * @param text - 表示文言
 */
function makeHint(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "column-placeholder";
  p.textContent = text;
  return p;
}

/**
 * 児童名のマグネット（ドラッグ可能）を作ります。
 * @param child - 表示する児童
 */
function makeMagnet(child: Child): HTMLElement {
  const magnet = document.createElement('div');
  magnet.className = `magnet magnet--${child.sex}`;
  magnet.draggable = true;
  magnet.setAttribute("role", "group");
  magnet.setAttribute("aria-label", `${child.name} のマグネット`);

  const name = document.createElement("span");
  name.className = "magnet-name";
  name.textContent = child.name;

  magnet.append(name);

  magnet.addEventListener("dragstart", (ev: DragEvent) => {
    const dt = ev.dataTransfer;
    if (!dt) return;
    dt.setData(DRAG_MIME, child.id);
    dt.effectAllowed = "move";
  });

  magnet.addEventListener("pointerdown", (ev: PointerEvent) => {
    startPointerDrag(ev, child, magnet);
  });

  magnet.addEventListener("pointermove", (ev: PointerEvent) => {
    if (!pointerDrag) return;
    ev.preventDefault();
    movePointerGhost(ev.clientX, ev.clientY);
  });

  magnet.addEventListener("pointerup", (ev: PointerEvent) => {
    if (!pointerDrag) return;
    ev.preventDefault();
    finishPointerDrag(ev.clientX, ev.clientY);
  });

  magnet.addEventListener("pointercancel", () => {
    cancelPointerDrag();
  });

  return magnet;
}

/**
 * 指定した ID の児童を一覧から削除し、保存と再描画を行います。
 * @param childId - 削除対象の児童 ID
 */
function removeChild(childId: string): void {
  const beforeCount = state.children.length;
  state.children = state.children.filter((child) => child.id !== childId);
  if (state.children.length === beforeCount) return;

  persist();
  render();
}

/**
 * 入力された名前と完全一致する児童を1名探して削除します。
 * @param name - 削除したい児童名
 * @returns 削除できた場合は true、該当なしの場合は false
 */
function removeChildByName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;

  const target = state.children.find((child) => child.name === trimmed);
  if (!target) return false;

  removeChild(target.id);
  return true;
}

/**
 * 登園列・降園列・お休み列に、ドラッグ＆ドロップの受け入れ処理を登録します。
 * @param root - 列の section 要素
 * @param col - arrival / departure / holiday
 */
function wireColumn(root: HTMLElement, col: AttendanceColumn): void {
  root.addEventListener("dragenter", () => {
    hovered = col;
    paintGlow();
  });

  root.addEventListener("dragover", (ev: DragEvent) => {
    ev.preventDefault();
    const dt = ev.dataTransfer;
    if (dt) dt.dropEffect = "move";
  });

  root.addEventListener("dragleave", (ev: DragEvent) => {
    const related = ev.relatedTarget as Node | null;
    if (!related || !root.contains(related)) {
      hovered = undefined;
      paintGlow();
    }
  });

  root.addEventListener("drop", (ev: DragEvent) => {
    ev.preventDefault();
    hovered = undefined;
    paintGlow();

    const id = ev.dataTransfer?.getData(DRAG_MIME);
    if (!id) return;

    const found = state.children.find((x) => x.id === id);
    if (!found) return;

    found.status = col;
    persist();
    render();
  });
}

/** 「児童を追加」ダイアログを開きます。 */
function dlgOpen(): void {
  dlgBackdrop.classList.remove("is-hidden");
  dlgBackdrop.setAttribute("aria-hidden", "false");
  dlgName.value = "";
  dlgSexMale.checked = true;
  dlgSexFemale.checked = false;
  dlgName.focus();
}

/** 追加ダイアログを閉じます。 */
function dlgClose(): void {
  dlgBackdrop.classList.add("is-hidden");
  dlgBackdrop.setAttribute("aria-hidden", "true");
}

/** 「児童を削除」ダイアログを開きます。 */
function deleteDlgOpen(): void {
  deleteDlgBackdrop.classList.remove("is-hidden");
  deleteDlgBackdrop.setAttribute("aria-hidden", "false");
  deleteDlgName.value = "";
  deleteDlgName.focus();
}

/** 削除ダイアログを閉じます。 */
function deleteDlgClose(): void {
  deleteDlgBackdrop.classList.add("is-hidden");
  deleteDlgBackdrop.setAttribute("aria-hidden", "true");
}

/**
 * 削除ダイアログの「削除」処理。入力名に完全一致する児童を1名削除します。
 * @returns 削除できた場合は true
 */
function confirmDeleteChild(): boolean {
  const name = deleteDlgName.value.trim();
  if (!name) {
    deleteDlgClose();
    return false;
  }

  const removed = removeChildByName(name);
  if (!removed) {
    alert(`「${name}」という名前の児童が見つかりませんでした。`);
    deleteDlgName.focus();
    return false;
  }

  deleteDlgClose();
  return true;
}

/**
 * ダイアログの「決定」処理。名前を state に追加し、画面を更新します。
 * @returns 名前が空で追加しなかった場合は false
 */
function confirmAddChild(): boolean {
  const name = dlgName.value.trim();
  if (!name) {
    dlgClose();
    return false;
  }

  const sex: ChildSex = dlgSexFemale.checked ? "female" : "male";

  state.children.push({
    id: newChildId(),
    name,
    status: "arrival",
    sex,
  });

  persist();
  render();
  dlgClose();
  return true;
}

/**
 * ボタン・ドラッグのイベントを登録し、保存済みデータを読み込みます。
 */
function init(): void {
  wireColumn(elArrivalCol, "arrival");
  wireColumn(elDepartureCol, "departure");
  wireColumn(elHolidayCol, "holiday");

  document.addEventListener("dragend", () => {
    hovered = undefined;
    paintGlow();
  });

  elClassName.addEventListener("input", () => {
    state.className = elClassName.value;
    persist();
  });

  btnAdd.addEventListener("click", dlgOpen);
  btnDelete.addEventListener("click", deleteDlgOpen);
  dlgCancel.addEventListener("click", dlgClose);

  dlgBackdrop.addEventListener("click", (evt) => {
    if (evt.target === dlgBackdrop) dlgClose();
  });

  deleteDlgCancel.addEventListener("click", deleteDlgClose);

  deleteDlgBackdrop.addEventListener("click", (evt) => {
    if (evt.target === deleteDlgBackdrop) deleteDlgClose();
  });

  dlgOk.addEventListener("click", () => {
    confirmAddChild();
  });

  deleteDlgOk.addEventListener("click", () => {
    confirmDeleteChild();
  });

  dlgName.addEventListener("keydown", (evt: KeyboardEvent) => {
    if (evt.key === "Enter") {
      evt.preventDefault();
      confirmAddChild();
    }
    if (evt.key === "Escape") dlgClose();
  });

  deleteDlgName.addEventListener("keydown", (evt: KeyboardEvent) => {
    if (evt.key === "Enter") {
      evt.preventDefault();
      confirmDeleteChild();
    }
    if (evt.key === "Escape") deleteDlgClose();
  });

  dlgPanel.addEventListener("keydown", (evt: KeyboardEvent) => {
    if (evt.key === "Escape") evt.stopPropagation();
  });

  deleteDlgPanel.addEventListener("keydown", (evt: KeyboardEvent) => {
    if (evt.key === "Escape") evt.stopPropagation();
  });

  loadFromStorage();
}

init();
