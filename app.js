const STORAGE_KEY = 'iskra-editor-v1';
const defaultSettings = {
  showDialogue: true, showLocation: false, dialogueMode: 'single', speaker: 'suxhxakos', speakerTwo: '', speakerThree: '',
  dialogue: 'Погодите-ка, а это что такое?', dialogueTwo: '', dialogueThree: '', position: 84, width: 76,
  flourish: 18, scale: 100, x: 50, location: 'Библиотека', subtitle: 'Вечер', locationCorner: 'bottom-right', locationOffset: 3,
};
const $ = (id) => document.getElementById(id);
const ui = {
  imageInput: $('imageInput'), exportOne: $('exportOne'), copyOne: $('copyOne'), exportZip: $('exportZip'), zipCount: $('zipCount'),
  addMore: $('addMore'), uploadButton: document.querySelector('.upload-button'),
  stage: $('stage'), stageShell: document.querySelector('.stage-shell'), sceneImage: $('sceneImage'),
  emptyState: $('emptyState'), dialogueOverlay: $('dialogueOverlay'), locationTag: $('locationTag'),
  speakerPreview: $('speakerPreview'), dialoguePreview: $('dialoguePreview'), locationPreview: $('locationPreview'), subtitlePreview: $('subtitlePreview'),
  speakerTwoPreview: $('speakerTwoPreview'), speakerThreePreview: $('speakerThreePreview'), dialogueTwoPreview: $('dialogueTwoPreview'), dialogueThreePreview: $('dialogueThreePreview'),
  dualSpeakers: $('dualSpeakers'), dualDialogues: $('dualDialogues'),
  locationFlourish: $('locationFlourish'), locationFlourishPath: $('locationFlourishPath'),
  speakerInput: $('speakerInput'), dialogueInput: $('dialogueInput'), locationInput: $('locationInput'), subtitleInput: $('subtitleInput'),
  speakerTwoInput: $('speakerTwoInput'), speakerThreeInput: $('speakerThreeInput'), dialogueTwoInput: $('dialogueTwoInput'), dialogueThreeInput: $('dialogueThreeInput'),
  dialogueMode: $('dialogueMode'), singleFields: $('singleFields'), dualFields: $('dualFields'), locationCornerInput: $('locationCornerInput'), locationOffsetInput: $('locationOffsetInput'), locationOffsetValue: $('locationOffsetValue'),
  dialogueEnabled: $('dialogueEnabled'), locationEnabled: $('locationEnabled'),
  dialogueToggle: $('dialogueToggle'), locationToggle: $('locationToggle'), dialogueFields: $('dialogueFields'), locationFields: $('locationFields'),
  saveName: $('saveName'), quickNames: $('quickNames'), characterCount: $('characterCount'),
  positionInput: $('positionInput'), positionValue: $('positionValue'), widthInput: $('widthInput'), widthValue: $('widthValue'),
  flourishInput: $('flourishInput'), flourishValue: $('flourishValue'), scaleInput: $('scaleInput'), scaleValue: $('scaleValue'),
  resetPosition: $('resetPosition'), resetDialogueStyle: $('resetDialogueStyle'), galleryStrip: $('galleryStrip'), galleryCount: $('galleryCount'), imageSummary: $('imageSummary'),
  activeOrdinal: $('activeOrdinal'), imageDimensions: $('imageDimensions'),
};
let items = [];
let activeId = null;
let dragOffset = null;
let locationDrag = null;
let busy = false;
let savedState = { names: ['suxhxakos'], templates: {}, draft: { ...defaultSettings }, collapsed: { dialogue: false, location: false } };

try {
  const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if (parsed && typeof parsed === 'object') savedState = {
    ...savedState, ...parsed,
    names: Array.isArray(parsed.names) ? parsed.names.filter((n) => typeof n === 'string').slice(0, 16) : savedState.names,
    templates: parsed.templates && typeof parsed.templates === 'object' ? parsed.templates : {},
    draft: { ...defaultSettings, ...(parsed.draft || {}) },
    collapsed: { ...savedState.collapsed, ...(parsed.collapsed || {}) },
  };
  if (parsed && typeof parsed === 'object' && !parsed.draft) {
    const legacy = { speaker: 'name', dialogue: 'dialogue', location: 'location', subtitle: 'locationSubtitle', position: 'position', width: 'width', flourish: 'flourish', x: 'x' };
    for (const [currentKey, oldKey] of Object.entries(legacy)) {
      if (parsed[oldKey] !== undefined) savedState.draft[currentKey] = parsed[oldKey];
    }
  }
} catch { /* Local editing still works if storage is unavailable. */ }

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || min)); }
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState)); } catch { /* Keep this session editable when browser storage is full. */ }
}
function activeItem() { return items.find((item) => item.id === activeId) || null; }
function imageKey(file) { return [file.name, file.size, file.lastModified].join('|'); }
let imageDbPromise;
function openImageDatabase() {
  if (!imageDbPromise) imageDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('iskra-image-gallery-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return imageDbPromise;
}
async function persistImageQueue() {
  try {
    const db = await openImageDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite');
      const store = transaction.objectStore('images');
      store.clear();
      items.forEach((item, order) => store.put({ id: item.id, file: item.file, include: item.include, order, settings: item.settings }));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch { /* Keep the current session usable if browser storage is unavailable. */ }
}
async function restoreImageQueue() {
  try {
    const db = await openImageDatabase();
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction('images').objectStore('images').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    items = records.sort((a, b) => a.order - b.order).map((record) => ({
      id: record.id, file: record.file, url: URL.createObjectURL(record.file), include: record.include !== false,
      settings: { ...defaultSettings, ...(record.settings || {}), ...(savedState.templates[record.id] || savedState.draft) },
    }));
    if (items.length) setActive(items.some((item) => item.id === savedState.activeImageId) ? savedState.activeImageId : items[0].id);
  } catch { /* The editor starts empty if this browser cannot restore its saved gallery. */ }
}
function fileTitle(name) { return name.replace(/\.[^.]+$/, '') || 'Кадр'; }

function readControls() {
  return {
    showDialogue: ui.dialogueEnabled.checked,
    showLocation: ui.locationEnabled.checked,
    dialogueMode: ui.dialogueMode.value,
    speaker: ui.speakerInput.value.slice(0, 36),
    speakerTwo: ui.speakerTwoInput.value.slice(0, 36),
    speakerThree: ui.speakerThreeInput.value.slice(0, 36),
    dialogue: ui.dialogueInput.value.slice(0, 280),
    dialogueTwo: ui.dialogueTwoInput.value.slice(0, 280),
    dialogueThree: ui.dialogueThreeInput.value.slice(0, 280),
    location: ui.locationInput.value.slice(0, 48),
    subtitle: ui.subtitleInput.value.slice(0, 36),
    locationCorner: ui.locationCornerInput.value,
    locationOffset: clamp(ui.locationOffsetInput.value, 0, 25),
    position: clamp(ui.positionInput.value, 0, 100),
    width: clamp(ui.widthInput.value, 30, 100),
    flourish: clamp(ui.flourishInput.value, 6, 48),
    scale: clamp(ui.scaleInput.value, 30, 220),
    x: 50,
  };
}
function saveActive() {
  const value = readControls();
  const item = activeItem();
  if (item) {
    item.settings = value;
    savedState.templates[item.id] = value;
    const templateKeys = Object.keys(savedState.templates);
    if (templateKeys.length > 60) delete savedState.templates[templateKeys[0]];
  } else savedState.draft = value;
  persist();
}
function syncScaleAcrossBatch(saveQueue = false) {
  const current = activeItem();
  if (!current) { refreshPreview(); return; }
  saveActive();
  const scale = clamp(ui.scaleInput.value, 30, 220);
  savedState.draft = { ...savedState.draft, scale };
  for (const item of items) {
    item.settings = { ...item.settings, scale };
    savedState.templates[item.id] = item.settings;
  }
  persist();
  if (saveQueue) persistImageQueue();
  refreshPreview(false);
}
function fitStage() {
  const shell = ui.stageShell.getBoundingClientRect();
  if (!shell.width || !shell.height) return;
  let ratio = 16 / 9;
  if (ui.sceneImage.naturalWidth && ui.sceneImage.naturalHeight) ratio = ui.sceneImage.naturalWidth / ui.sceneImage.naturalHeight;
  const width = Math.min(shell.width, shell.height * ratio);
  const height = width / ratio;
  ui.stage.style.width = width + 'px';
  ui.stage.style.height = height + 'px';
}
function applyControls(settings) {
  ui.dialogueEnabled.checked = settings.showDialogue !== false;
  ui.locationEnabled.checked = settings.showLocation !== false;
  ui.speakerInput.value = settings.speaker ?? defaultSettings.speaker;
  ui.dialogueInput.value = settings.dialogue ?? defaultSettings.dialogue;
  ui.locationInput.value = settings.location ?? defaultSettings.location;
  ui.subtitleInput.value = settings.subtitle ?? defaultSettings.subtitle;
  ui.speakerTwoInput.value = settings.speakerTwo ?? '';
  ui.speakerThreeInput.value = settings.speakerThree ?? '';
  ui.dialogueTwoInput.value = settings.dialogueTwo ?? '';
  ui.dialogueThreeInput.value = settings.dialogueThree ?? '';
  ui.dialogueMode.value = settings.dialogueMode === 'dual' ? 'dual' : 'single';
  ui.locationCornerInput.value = settings.locationCorner ?? 'bottom-right';
  const savedLocationOffset = settings.locationOffset ?? 5;
  ui.locationOffsetInput.value = clamp(savedLocationOffset === 0 || savedLocationOffset === 2 || savedLocationOffset === 5 ? 3 : savedLocationOffset, 0, 25);
  ui.singleFields.hidden = ui.dialogueMode.value === 'dual';
  ui.dualFields.hidden = ui.dialogueMode.value !== 'dual';
  ui.positionInput.value = clamp(settings.position, 0, 100);
  ui.widthInput.value = clamp(settings.width, 30, 100);
  ui.flourishInput.value = clamp(settings.flourish, 6, 48);
  ui.scaleInput.value = clamp(settings.scale, 30, 220);
  refreshPreview(false);
}
function refreshPreview(save = true) {
  const settings = readControls();
  const item = activeItem();
  setPreviewText(ui.speakerPreview, settings.speaker);
  setPreviewText(ui.dialoguePreview, settings.dialogue);
  setPreviewText(ui.speakerTwoPreview, settings.speakerTwo);
  setPreviewText(ui.speakerThreePreview, settings.speakerThree);
  setPreviewText(ui.dialogueTwoPreview, settings.dialogueTwo);
  setPreviewText(ui.dialogueThreePreview, settings.dialogueThree);
  setPreviewText(ui.locationPreview, settings.location);
  setPreviewText(ui.subtitlePreview, settings.subtitle);
  ui.dialogueOverlay.hidden = !item || !settings.showDialogue;
  ui.locationTag.hidden = !item || !settings.showLocation || !settings.location.trim();
  ui.locationTag.dataset.corner = settings.locationCorner;
  ui.locationTag.style.setProperty('--location-edge', settings.locationOffset + '%');
  ui.locationTag.style.setProperty('--shade-extend-x', (ui.stage.clientWidth * settings.locationOffset / 100 + 96) + 'px');
  ui.locationTag.style.setProperty('--shade-extend-y', (ui.stage.clientHeight * settings.locationOffset / 100 + 96) + 'px');
  const dual = settings.dialogueMode === 'dual';
  ui.speakerPreview.hidden = dual;
  ui.dialoguePreview.hidden = dual;
  ui.dualSpeakers.hidden = !dual;
  ui.dualDialogues.hidden = !dual;
  ui.singleFields.hidden = dual;
  ui.dualFields.hidden = !dual;
  ui.dialogueOverlay.classList.toggle('is-dual', dual);
  ui.dialogueOverlay.style.top = settings.position + '%';
  ui.dialogueOverlay.style.left = settings.x + '%';
  ui.dialogueOverlay.style.width = settings.width + '%';
  ui.stage.style.setProperty('--ui-scale', settings.scale / 100);
  ui.stage.style.setProperty('--flourish-size', settings.flourish);
  ui.stage.style.setProperty('--ornament-scale', settings.flourish / 18);
  ui.locationFlourish.style.width = '';
  const flourishUnit = Math.max(38, parseFloat(getComputedStyle(ui.locationFlourish).width) || 0) / 38;
  const locationRuleWidth = Math.max(38, ui.locationTag.getBoundingClientRect().width);
  ui.locationFlourish.setAttribute('viewBox', '0 0 ' + locationRuleWidth + ' 14');
  const x = (value) => (value * flourishUnit).toFixed(3);
  ui.locationFlourishPath.setAttribute('d', 'M0 9 C' + x(2) + ' 9 ' + x(3) + ' 3 ' + x(8) + ' 2 C' + x(12) + ' 1 ' + x(15) + ' 4 ' + x(13) + ' 7 C' + x(11) + ' 10 ' + x(7) + ' 9 ' + x(8) + ' 6 C' + x(9) + ' 3.8 ' + x(13) + ' 4.5 ' + x(16) + ' 6 C' + x(18) + ' 7 ' + x(20) + ' 7 ' + x(23) + ' 7 L' + locationRuleWidth + ' 7');
  if (!ui.locationTag.hidden) ui.locationFlourish.style.width = locationRuleWidth + 'px';
  if (item && settings.showDialogue && ui.stage.clientHeight) {
    const shadeTop = Math.abs(parseFloat(getComputedStyle(ui.dialogueOverlay, '::before').top)) || 0;
    const halfHeight = (ui.dialogueOverlay.offsetHeight / 2 + shadeTop) / ui.stage.clientHeight * 100;
    settings.position = clamp(settings.position, halfHeight, 100 - halfHeight);
    ui.positionInput.value = settings.position;
    ui.dialogueOverlay.style.top = settings.position + '%';
  }
  ui.stage.style.setProperty('--ui-scale', settings.scale / 100);
  ui.stage.style.setProperty('--flourish-size', settings.flourish);
  ui.stage.style.setProperty('--ornament-scale', settings.flourish / 18);
  const shownCharacters = dual ? settings.dialogueTwo.length + settings.dialogueThree.length : settings.dialogue.length;
  ui.characterCount.textContent = shownCharacters + ' / ' + (dual ? '560' : '280');
  ui.positionValue.textContent = settings.position + '%';
  ui.widthValue.textContent = settings.width + '%';
  ui.flourishValue.textContent = Math.round(settings.flourish / 18 * 100) + '%';
  ui.scaleValue.textContent = settings.scale + '%';
  ui.locationOffsetValue.textContent = settings.locationOffset + '%';
  if (save) saveActive();
}
function setPreviewText(node, value) {
  if (document.activeElement !== node) node.textContent = value;
}
function applyCollapsedState() {
  for (const [key, toggle, fields] of [
    ['dialogue', ui.dialogueToggle, ui.dialogueFields],
    ['location', ui.locationToggle, ui.locationFields],
  ]) {
    const expanded = !savedState.collapsed[key];
    toggle.setAttribute('aria-expanded', String(expanded));
    fields.hidden = !expanded;
  }
}
function renderNames() {
  ui.quickNames.replaceChildren();
  for (const name of savedState.names) {
    const group = document.createElement('span'); group.className = 'name-chip-group';
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'name-chip'; chip.textContent = name;
    chip.addEventListener('click', () => {
      const input = ui.nameTarget || ui.speakerInput;
      input.value = name; input.focus(); input.select(); refreshPreview();
    });
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'name-chip-remove'; remove.textContent = '×';
    remove.title = 'Удалить «' + name + '» из быстрых имён'; remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => {
      savedState.names = savedState.names.filter((savedName) => savedName !== name);
      persist(); renderNames();
    });
    group.append(chip, remove); ui.quickNames.append(group);
  }
}
function saveName() {
  const name = (ui.nameTarget || ui.speakerInput).value.trim();
  if (!name) return;
  savedState.names = [name, ...savedState.names.filter((value) => value.toLocaleLowerCase() !== name.toLocaleLowerCase())].slice(0, 16);
  persist(); renderNames();
}
function renderGallery() {
  ui.galleryStrip.replaceChildren();
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'gallery-item' + (item.id === activeId ? ' is-active' : '');
    card.draggable = true;
    card.addEventListener('dragstart', (event) => {
      if (event.target.closest('.gallery-item-footer')) { event.preventDefault(); return; }
      galleryDragId = item.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.id);
      requestAnimationFrame(() => card.classList.add('is-dragging'));
    });
    card.addEventListener('dragover', (event) => {
      if (!galleryDragId || galleryDragId === item.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      ui.galleryStrip.querySelectorAll('.gallery-item').forEach((node) => node.classList.remove('drop-before', 'drop-after'));
      card.classList.add(event.clientX < card.getBoundingClientRect().left + card.offsetWidth / 2 ? 'drop-before' : 'drop-after');
    });
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      const sourceId = galleryDragId || event.dataTransfer.getData('text/plain');
      const after = event.clientX >= card.getBoundingClientRect().left + card.offsetWidth / 2;
      reorderGallery(sourceId, item.id, after);
      clearGalleryDrag();
    });
    card.addEventListener('dragend', clearGalleryDrag);
    const select = document.createElement('button');
    select.type = 'button'; select.className = 'gallery-select'; select.setAttribute('aria-label', 'Открыть кадр ' + item.file.name);
    const thumb = document.createElement('img'); thumb.src = item.url; thumb.alt = '';
    const label = document.createElement('span'); label.className = 'gallery-name'; label.textContent = fileTitle(item.file.name);
    select.append(thumb, label);
    select.addEventListener('click', () => setActive(item.id));
    const footer = document.createElement('div'); footer.className = 'gallery-item-footer';
    const includeLabel = document.createElement('label'); includeLabel.className = 'include-label';
    const include = document.createElement('input'); include.type = 'checkbox'; include.checked = item.include; include.setAttribute('aria-label', 'Добавить ' + item.file.name + ' в ZIP');
    include.addEventListener('change', () => { item.include = include.checked; persistImageQueue(); updateCounts(); });
    const includeText = document.createElement('span'); includeText.textContent = 'В ZIP';
    includeLabel.append(include, includeText);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-image'; remove.textContent = '×'; remove.title = 'Убрать кадр';
    remove.addEventListener('click', () => removeItem(item.id));
    footer.append(includeLabel, remove);
    card.append(select, footer); ui.galleryStrip.append(card);
  }
  ui.galleryStrip.append(ui.addMore);
  updateCounts();
}
function clearGalleryDrag() {
  galleryDragId = null;
  ui.galleryStrip.querySelectorAll('.gallery-item').forEach((card) => card.classList.remove('is-dragging', 'drop-before', 'drop-after'));
}
function reorderGallery(sourceId, targetId, after) {
  const from = items.findIndex((item) => item.id === sourceId);
  const target = items.findIndex((item) => item.id === targetId);
  if (from < 0 || target < 0 || from === target) return;
  const [moved] = items.splice(from, 1);
  const insertAt = target + (after ? 1 : 0) - (from < target ? 1 : 0);
  items.splice(insertAt, 0, moved);
  persistImageQueue();
  renderGallery();
}
function updateCounts() {
  const count = items.length, included = items.filter((item) => item.include).length;
  ui.galleryCount.textContent = String(count);
  ui.zipCount.textContent = String(included);
  ui.exportZip.disabled = busy || included === 0;
  ui.exportOne.disabled = busy || !activeItem();
  ui.copyOne.disabled = busy || !activeItem();
  ui.resetPosition.disabled = !activeItem();
  ui.resetDialogueStyle.disabled = !activeItem();
  ui.imageSummary.textContent = count ? count + (count === 1 ? ' кадр в галерее' : ' кадров в галерее') : 'Сначала добавьте хотя бы один кадр';
  const current = activeItem(), index = current ? items.indexOf(current) + 1 : 0;
  ui.activeOrdinal.textContent = String(index).padStart(2, '0');
  if (current) {
    ui.uploadButton.querySelector('strong').textContent = 'Добавить ещё изображения';
    ui.uploadButton.querySelector('small').textContent = 'Добавьте кадры к текущей галерее';
    ui.imageDimensions.textContent = current.file.name + ' · только в этом браузере';
  } else {
    ui.uploadButton.querySelector('strong').textContent = 'Добавить изображения';
    ui.uploadButton.querySelector('small').textContent = 'PNG, JPG или WEBP · можно несколько';
    ui.imageDimensions.textContent = 'ИСХОДНЫЙ КАДР НЕ ИЗМЕНЯЕТСЯ';
  }
}
function setActive(id) {
  if (activeId) saveActive();
  activeId = id;
  savedState.activeImageId = id;
  persist();
  const item = activeItem();
  if (!item) {
    ui.sceneImage.removeAttribute('src'); ui.sceneImage.hidden = true; ui.emptyState.hidden = false;
    applyControls(savedState.draft); renderGallery(); fitStage(); return;
  }
  ui.sceneImage.onload = () => { fitStage(); refreshPreview(); };
  ui.sceneImage.src = item.url;
  ui.sceneImage.hidden = false; ui.emptyState.hidden = true;
  applyControls(item.settings);
  renderGallery(); fitStage();
}
function addFiles(fileList) {
  let firstNew = null;
  for (const file of fileList) {
    if (!file.type.startsWith('image/')) continue;
    const id = imageKey(file);
    if (items.some((item) => item.id === id)) continue;
    const settings = { ...defaultSettings, ...(savedState.templates[id] || savedState.draft) };
    const item = { id, file, url: URL.createObjectURL(file), include: true, settings };
    items.push(item); if (!firstNew) firstNew = item.id;
  }
  if (firstNew) { setActive(firstNew); persistImageQueue(); }
}
function removeItem(id) {
  const index = items.findIndex((item) => item.id === id); if (index < 0) return;
  const wasActive = activeId === id;
  if (wasActive) saveActive();
  URL.revokeObjectURL(items[index].url); items.splice(index, 1);
  persistImageQueue();
  if (wasActive) {
    activeId = null;
    const next = items[Math.min(index, items.length - 1)];
    setActive(next ? next.id : null);
  } else renderGallery();
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function wrapLines(context, text, width) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      let candidate = line ? line + ' ' + word : word;
      if (line && context.measureText(candidate).width > width) { lines.push(line); line = ''; candidate = word; }
      while (context.measureText(candidate).width > width && candidate.length > 1) {
        let split = candidate.length - 1;
        while (split > 1 && context.measureText(candidate.slice(0, split)).width > width) split--;
        lines.push(candidate.slice(0, split)); candidate = candidate.slice(split);
      }
      line = candidate;
    }
    if (line) lines.push(line);
  }
  return lines;
}
function drawOrnament(context, x, y, width, scale, flourish) {
  const inset = 9 * scale, left = x + inset, right = x + width - inset;
  const center = x + width / 2, edgeDiamond = flourish * .28, halfW = flourish * .22, halfH = flourish * .22;
  context.save(); context.lineWidth = Math.max(1, scale); context.shadowColor = '#000'; context.shadowBlur = 3 * scale; context.strokeStyle = '#e2bd65';
  context.beginPath(); context.moveTo(x, y); context.lineTo(center, y); context.lineTo(x + width, y); context.stroke();
  context.beginPath(); context.moveTo(center - halfW, y); context.lineTo(center, y - halfH); context.lineTo(center + halfW, y); context.lineTo(center, y + halfH); context.closePath(); context.stroke();
  for (const point of [left, right]) { context.save(); context.translate(point, y); context.rotate(Math.PI / 4); context.strokeRect(-edgeDiamond / 2, -edgeDiamond / 2, edgeDiamond, edgeDiamond); context.restore(); }
  context.restore();
}
function drawLocationSwash(context, x, y, flourishWidth, totalWidth, scale) {
  const unit = flourishWidth / 38, point = (xValue, yValue) => [x + xValue * unit, y + (yValue - 7) * unit];
  context.save(); context.strokeStyle = '#d2ad58'; context.lineWidth = Math.max(1, scale); context.lineCap = 'round'; context.lineJoin = 'round';
    const [startX, startY] = point(0, 9), [a1x,a1y] = point(2,9), [a2x,a2y] = point(3,3), [a3x,a3y] = point(8,2);
  context.beginPath(); context.moveTo(startX,startY); context.bezierCurveTo(a1x,a1y,a2x,a2y,a3x,a3y);
    const [b1x,b1y] = point(12,1), [b2x,b2y] = point(15,4), [b3x,b3y] = point(13,7); context.bezierCurveTo(b1x,b1y,b2x,b2y,b3x,b3y);
    const [c1x,c1y] = point(11,10), [c2x,c2y] = point(7,9), [c3x,c3y] = point(8,6); context.bezierCurveTo(c1x,c1y,c2x,c2y,c3x,c3y);
    const [d1x,d1y] = point(9,3.8), [d2x,d2y] = point(13,4.5), [d3x,d3y] = point(16,6); context.bezierCurveTo(d1x,d1y,d2x,d2y,d3x,d3y);
    const [e1x,e1y] = point(18,7), [e2x,e2y] = point(20,7), [e3x,e3y] = point(23,7); context.bezierCurveTo(e1x,e1y,e2x,e2y,e3x,e3y);
  const [endX,endY] = point(38,7); context.lineTo(endX,endY); context.lineTo(x + totalWidth, y); context.stroke(); context.restore();
}
function drawShade(context, center, top, width, height, blur) {
  blur = Math.max(1, blur);
  const padding = Math.ceil(blur * 3);
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.ceil(width + padding * 2)); layer.height = Math.max(1, Math.ceil(height + padding * 2));
  const shade = layer.getContext('2d'), vertical = shade.createLinearGradient(0, padding, 0, padding + height);
  vertical.addColorStop(0, 'rgba(0,0,0,0)'); vertical.addColorStop(.1, 'rgba(0,0,0,.12)'); vertical.addColorStop(.36, 'rgba(0,0,0,.42)'); vertical.addColorStop(.68, 'rgba(0,0,0,.62)'); vertical.addColorStop(.8, 'rgba(0,0,0,.72)'); vertical.addColorStop(.94, 'rgba(0,0,0,.35)'); vertical.addColorStop(1, 'rgba(0,0,0,0)');
  shade.fillStyle = vertical; shade.fillRect(padding, padding, width, height); shade.globalCompositeOperation = 'destination-in';
  const horizontal = shade.createLinearGradient(padding, 0, padding + width, 0);
  horizontal.addColorStop(0, 'rgba(0,0,0,0)'); horizontal.addColorStop(.13, '#000'); horizontal.addColorStop(.87, '#000'); horizontal.addColorStop(1, 'rgba(0,0,0,0)');
  shade.fillStyle = horizontal; shade.fillRect(padding, padding, width, height);
  context.save(); context.globalCompositeOperation = 'multiply'; context.filter = 'blur(' + blur + 'px)';
  context.drawImage(layer, center - width / 2 - padding, top - padding); context.restore();
}
function drawLocationShade(context, left, top, width, titleFont, outputScale, leftCorner, topCorner) {
  const blur = 48 * outputScale, padding = Math.ceil(blur * 3);
  const layer = document.createElement('canvas'); layer.width = context.canvas.width + padding * 2; layer.height = context.canvas.height + padding * 2;
  const shade = layer.getContext('2d'); shade.filter = 'blur(' + blur + 'px)'; shade.fillStyle = 'rgba(0,0,0,.75)';
  const rectLeft = leftCorner ? -padding : left - context.canvas.width * .08;
  const rectTop = topCorner ? -padding : top - context.canvas.height * .08;
  const rectRight = leftCorner ? left + width + context.canvas.width * .08 : context.canvas.width + padding;
  const rectBottom = topCorner ? top + titleFont * 2.2 + context.canvas.height * .08 : context.canvas.height + padding;
  shade.fillRect(padding + rectLeft, padding + rectTop, rectRight - rectLeft, rectBottom - rectTop);
  context.save(); context.globalCompositeOperation = 'multiply'; context.drawImage(layer, -padding, -padding); context.restore();
}
async function renderPng(item) {
  const image = await createImageBitmap(item.file), canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); image.close();
  const s = item.settings, scale = s.scale / 100, fontBasis = Math.min(canvas.width, canvas.height), center = canvas.width * s.x / 100, centerY = canvas.height * s.position / 100;
  const width = canvas.width * s.width / 100, font = Math.max(14, fontBasis * .025) * scale;
  await document.fonts.ready;
  if (s.showDialogue && s.dialogueMode !== 'dual') {
    context.textAlign = 'center'; context.textBaseline = 'middle';
    const bodyFont = Math.max(13, fontBasis * .021) * scale;
    context.font = '600 ' + bodyFont + 'px Georgia, serif';
    const lines = wrapLines(context, s.dialogue, width * .95), lineHeight = fontBasis * .029 * scale;
    drawShade(context, center, centerY - font * 2.15, width * 1.5, font * 4.35 + Math.max(0, lines.length - 1) * lineHeight, fontBasis * .011 * scale);
    context.shadowColor = 'rgba(0,0,0,.42)'; context.shadowBlur = 0; context.shadowOffsetY = 1 * scale;
    context.fillStyle = '#ffd15f'; context.font = '700 ' + font + 'px Georgia, serif';
    context.fillText(s.speaker, center, centerY - font * 1.05); context.shadowOffsetY = 0;
    drawOrnament(context, center - width / 2, centerY + font * .23, width, canvas.width / Math.max(1, ui.stage.clientWidth) * scale, s.flourish * canvas.width / 1000 * scale);
    context.shadowBlur = 0; context.shadowOffsetY = 0;
    context.fillStyle = '#fff'; context.font = '600 ' + bodyFont + 'px Georgia, serif';
    context.shadowColor = 'rgba(0,0,0,.42)'; context.shadowBlur = 0; context.shadowOffsetY = 1 * scale;
    lines.forEach((line, i) => context.fillText(line, center, centerY + font * .95 + i * lineHeight));
    context.save(); context.shadowColor = '#000'; context.shadowBlur = 5 * scale; context.strokeStyle = '#e2b942'; context.lineWidth = 1.5 * scale;
    context.translate(center, centerY + font * 2.2 + Math.max(0, lines.length - 1) * lineHeight); context.rotate(Math.PI / 4); context.strokeRect(-6 * scale, -6 * scale, 12 * scale, 12 * scale); context.restore();
  }
  if (s.showDialogue && s.dialogueMode === 'dual') {
    const bodyFont = Math.max(13, fontBasis * .021) * scale, lineHeight = fontBasis * .029 * scale;
    const columnWidth = width * .46;
    context.font = '600 ' + bodyFont + 'px Georgia, serif';
    const leftLines = wrapLines(context, s.dialogueTwo, columnWidth), rightLines = wrapLines(context, s.dialogueThree, columnWidth);
    const count = Math.max(leftLines.length, rightLines.length, 1);
    drawShade(context, center, centerY - font * 2.15, width * 1.5, font * 4.35 + Math.max(0, count - 1) * lineHeight, fontBasis * .011 * scale);
    context.fillStyle = '#ffd15f'; context.font = '700 ' + font + 'px Georgia, serif'; context.shadowColor = 'rgba(0,0,0,.42)'; context.shadowBlur = 0; context.shadowOffsetY = 1 * scale;
    const leftNames = wrapLines(context, s.speakerTwo, columnWidth), rightNames = wrapLines(context, s.speakerThree, columnWidth);
    const nameRows = Math.max(leftNames.length, rightNames.length, 1);
    context.textAlign = 'left'; leftNames.forEach((line, i) => context.fillText(line, center - width * .48, centerY - font * 1.05 - (nameRows - i - 1) * font * 1.2));
    context.textAlign = 'right'; rightNames.forEach((line, i) => context.fillText(line, center + width * .48, centerY - font * 1.05 - (nameRows - i - 1) * font * 1.2));
    context.shadowOffsetY = 0;
    drawOrnament(context, center - width / 2, centerY + font * .23, width, canvas.width / Math.max(1, ui.stage.clientWidth) * scale, s.flourish * canvas.width / 1000 * scale);
    context.shadowBlur = 0; context.shadowOffsetY = 0;
    context.fillStyle = '#fff'; context.font = '600 ' + bodyFont + 'px Georgia, serif';
    context.shadowColor = 'rgba(0,0,0,.42)'; context.shadowBlur = 0; context.shadowOffsetY = 1 * scale;
    context.textAlign = 'left'; leftLines.forEach((line, i) => context.fillText(line, center - width * .48, centerY + font * .95 + i * lineHeight));
    context.textAlign = 'right'; rightLines.forEach((line, i) => context.fillText(line, center + width * .48, centerY + font * .95 + i * lineHeight));
    context.save(); context.shadowColor = '#000'; context.shadowBlur = 5 * scale; context.strokeStyle = '#e2b942'; context.lineWidth = 1.5 * scale;
    context.translate(center, centerY + font * 2.2 + Math.max(0, count - 1) * lineHeight); context.rotate(Math.PI / 4); context.strokeRect(-6 * scale, -6 * scale, 12 * scale, 12 * scale); context.restore();
  }
  if (s.showLocation && s.location.trim()) {
    const titleFont = Math.max(20, fontBasis * .035) * scale, subFont = Math.max(15, fontBasis * .024) * scale;
    context.save(); context.textAlign = 'left'; context.textBaseline = 'middle';
    context.fillStyle = '#ffee8e'; context.font = '600 ' + titleFont + 'px "Cormorant Garamond", Georgia, serif';
    const titleWidth = context.measureText(s.location).width;
    context.font = '500 ' + subFont + 'px "Cormorant Garamond", Georgia, serif';
    const subtitleWidth = s.subtitle.trim() ? context.measureText(s.subtitle).width : 0;
    const swashWidth = fontBasis * .029 * (s.flourish / 18) * scale;
    const boxWidth = Math.min(canvas.width * .46, Math.max(titleWidth, subtitleWidth, swashWidth * 3));
    const corner = s.locationCorner || 'bottom-right', edge = (s.locationOffset ?? 3) / 100;
    const offsetX = canvas.width * edge, offsetY = canvas.height * edge;
    const leftCorner = corner.endsWith('left'), topCorner = corner.startsWith('top');
    const left = leftCorner ? offsetX : canvas.width - offsetX - boxWidth;
    const top = topCorner ? offsetY : canvas.height - offsetY - titleFont * 2.5;
    const ruleY = top + titleFont * 1.14;
    drawLocationShade(context, left, top, boxWidth, titleFont, canvas.width / Math.max(1, ui.stage.clientWidth), leftCorner, topCorner);
    context.shadowColor = 'transparent'; context.shadowBlur = 0; context.shadowOffsetY = 0;
    context.fillStyle = '#ffee8e'; context.font = '600 ' + titleFont + 'px "Cormorant Garamond", Georgia, serif';
    context.textAlign = 'left';
    context.fillText(s.location, left, top + titleFont * .62);
    context.shadowBlur = 0; context.shadowOffsetY = 0; context.strokeStyle = '#d2ad58'; context.lineWidth = Math.max(1, canvas.width / Math.max(1, ui.stage.clientWidth) * scale);
    drawLocationSwash(context, left, ruleY, swashWidth, boxWidth, Math.max(1, canvas.width / Math.max(1, ui.stage.clientWidth) * scale));
    if (s.subtitle.trim()) { context.fillStyle = '#fff'; context.font = '500 ' + subFont + 'px "Cormorant Garamond", Georgia, serif'; context.textAlign = 'left'; context.fillText(s.subtitle, left, top + titleFont * 1.8); }
    context.restore();
  }
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Не удалось собрать PNG.')), 'image/png'));
}
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
async function zipBlob(entries) {
  const encoder = new TextEncoder(), chunks = [], central = []; let offset = 0;
  const w16 = (view, i, v) => view.setUint16(i, v, true), w32 = (view, i, v) => view.setUint32(i, v >>> 0, true);
  for (let i = 0; i < entries.length; i++) {
    const nameBytes = encoder.encode(String(i + 1).padStart(2, '0') + '_' + entries[i].name), data = new Uint8Array(await entries[i].blob.arrayBuffer()), crc = crc32(data);
    const local = new Uint8Array(30), lv = new DataView(local.buffer);
    w32(lv, 0, 0x04034b50); w16(lv, 4, 20); w16(lv, 6, 0x0800); w16(lv, 8, 0); w16(lv, 10, 0); w16(lv, 12, 33);
    w32(lv, 14, crc); w32(lv, 18, data.length); w32(lv, 22, data.length); w16(lv, 26, nameBytes.length); w16(lv, 28, 0);
    chunks.push(local, nameBytes, data);
    const head = new Uint8Array(46), cv = new DataView(head.buffer);
    w32(cv, 0, 0x02014b50); w16(cv, 4, 20); w16(cv, 6, 20); w16(cv, 8, 0x0800); w16(cv, 10, 0); w16(cv, 12, 0); w16(cv, 14, 33);
    w32(cv, 16, crc); w32(cv, 20, data.length); w32(cv, 24, data.length); w16(cv, 28, nameBytes.length); w16(cv, 30, 0); w16(cv, 32, 0); w16(cv, 34, 0); w16(cv, 36, 0); w32(cv, 38, 0); w32(cv, 42, offset);
    central.push(head, nameBytes); offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, part) => n + part.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  w32(ev, 0, 0x06054b50); w16(ev, 4, 0); w16(ev, 6, 0); w16(ev, 8, entries.length); w16(ev, 10, entries.length); w32(ev, 12, centralSize); w32(ev, 16, offset); w16(ev, 20, 0);
  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}
function safeFilename(name) { return name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 90) || 'scene'; }
async function exportCurrent() {
  const item = activeItem(); if (!item || busy) return;
  saveActive(); busy = true; updateCounts();
  try { download(await renderPng(item), safeFilename(item.file.name) + '-dialog.png'); }
  catch (error) { alert(error.message || 'Не удалось создать PNG.'); }
  finally { busy = false; updateCounts(); }
}
async function copyCurrent() {
  const item = activeItem(); if (!item || busy) return;
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    alert('Копирование PNG доступно в браузере на защищённой странице HTTPS.'); return;
  }
  saveActive(); busy = true; updateCounts();
  try {
    const png = renderPng(item);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    ui.copyOne.textContent = 'Скопировано';
    setTimeout(() => { ui.copyOne.textContent = 'Копировать PNG'; }, 1400);
  } catch (error) {
    alert(error.name === 'NotAllowedError' ? 'Браузер запретил доступ к буферу. Разрешите копирование и нажмите ещё раз.' : (error.message || 'Не удалось скопировать PNG.'));
  } finally { busy = false; updateCounts(); }
}
async function exportBatch() {
  const chosen = items.filter((item) => item.include); if (!chosen.length || busy) return;
  saveActive(); busy = true; updateCounts(); const labelNode = ui.exportZip.firstChild, originalLabel = labelNode.textContent;
  try {
    const entries = [];
    for (let i = 0; i < chosen.length; i++) {
      labelNode.textContent = 'Собираю ' + (i + 1) + '/' + chosen.length + ' ';
      entries.push({ name: safeFilename(chosen[i].file.name) + '-dialog.png', blob: await renderPng(chosen[i]) });
    }
    download(await zipBlob(entries), 'iskra-scenes.zip');
  } catch (error) { alert(error.message || 'Не удалось собрать архив.'); }
  finally { busy = false; labelNode.textContent = originalLabel; updateCounts(); }
}
function startDrag(event) {
  if (!activeItem() || !ui.dialogueEnabled.checked) return;
  if (event.target.closest('.preview-editable')) return;
  event.preventDefault(); ui.dialogueOverlay.setPointerCapture(event.pointerId);
  const bounds = ui.stage.getBoundingClientRect(), settings = readControls();
  dragOffset = (event.clientY - bounds.top) / bounds.height * 100 - settings.position;
}
function moveDrag(event) {
  if (!dragOffset || !ui.stage.clientWidth || !ui.stage.clientHeight) return;
  const bounds = ui.stage.getBoundingClientRect();
  const shadeTop = Math.abs(parseFloat(getComputedStyle(ui.dialogueOverlay, '::before').top)) || 0;
  const halfHeight = (ui.dialogueOverlay.offsetHeight / 2 + shadeTop) / bounds.height * 100;
  const centerY = clamp((event.clientY - bounds.top) / bounds.height * 100 - dragOffset, halfHeight, 100 - halfHeight);
  ui.dialogueOverlay.style.top = centerY + '%'; ui.positionInput.value = centerY; refreshPreview();
}
function resetDialogueStyle() {
  if (!activeItem()) return;
  ui.positionInput.value = defaultSettings.position;
  ui.widthInput.value = defaultSettings.width;
  refreshPreview();
}
function startLocationDrag(event) {
  if (!activeItem() || !ui.locationEnabled.checked) return;
  if (event.target.closest('.preview-editable')) return;
  event.preventDefault(); ui.locationTag.setPointerCapture(event.pointerId);
  const bounds = ui.stage.getBoundingClientRect(), tag = ui.locationTag.getBoundingClientRect();
  locationDrag = { pointerId: event.pointerId, offsetX: event.clientX - tag.left, offsetY: event.clientY - tag.top };
  ui.locationTag.classList.add('is-dragging');
  ui.locationTag.style.left = tag.left - bounds.left + 'px'; ui.locationTag.style.top = tag.top - bounds.top + 'px';
  ui.locationTag.style.right = 'auto'; ui.locationTag.style.bottom = 'auto';
  ui.locationTag.style.width = tag.width + 'px';
  ui.locationTag.style.setProperty('transform', 'none');
}
function moveLocationDrag(event) {
  if (!locationDrag || !ui.stage.clientWidth || !ui.stage.clientHeight) return;
  const bounds = ui.stage.getBoundingClientRect(), tag = ui.locationTag.getBoundingClientRect();
  const left = clamp(event.clientX - bounds.left - locationDrag.offsetX, 0, bounds.width - tag.width);
  const top = clamp(event.clientY - bounds.top - locationDrag.offsetY, 0, bounds.height - tag.height);
  ui.locationTag.style.left = left + 'px'; ui.locationTag.style.top = top + 'px';
}
function finishLocationDrag(event) {
  if (!locationDrag) return;
  if (event.type === 'pointerup') {
    const bounds = ui.stage.getBoundingClientRect(), tag = ui.locationTag.getBoundingClientRect();
    const centerX = (tag.left + tag.width / 2 - bounds.left) / bounds.width;
    const centerY = (tag.top + tag.height / 2 - bounds.top) / bounds.height;
    ui.locationCornerInput.value = (centerY < .5 ? 'top-' : 'bottom-') + (centerX < .5 ? 'left' : 'right');
    ui.locationOffsetInput.value = 3;
  }
  locationDrag = null; ui.locationTag.classList.remove('is-dragging');
  ui.locationTag.style.left = ''; ui.locationTag.style.top = ''; ui.locationTag.style.right = ''; ui.locationTag.style.bottom = ''; ui.locationTag.style.width = ''; ui.locationTag.style.transform = '';
  refreshPreview();
}

ui.imageInput.addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
window.addEventListener('paste', (event) => {
  const clipboardItems = Array.from(event.clipboardData?.items || []);
  const images = clipboardItems.filter((item) => item.type.startsWith('image/')).map((item, index) => {
    const image = item.getAsFile();
    if (!image) return null;
    const extension = image.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    return new File([image], 'clipboard-' + Date.now() + '-' + index + '.' + extension, { type: image.type, lastModified: Date.now() });
  }).filter(Boolean);
  if (!images.length) return;
  event.preventDefault();
  addFiles(images);
});
ui.addMore.addEventListener('click', () => ui.imageInput.click());
ui.exportOne.addEventListener('click', exportCurrent); ui.copyOne.addEventListener('click', copyCurrent); ui.exportZip.addEventListener('click', exportBatch); ui.saveName.addEventListener('click', saveName);
for (const input of [ui.speakerInput, ui.speakerTwoInput, ui.speakerThreeInput]) input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); ui.nameTarget = input; saveName(); } });
ui.nameTarget = ui.speakerInput;
for (const input of [ui.speakerInput, ui.speakerTwoInput, ui.speakerThreeInput]) input.addEventListener('focus', () => { ui.nameTarget = input; });
for (const input of [ui.speakerInput, ui.dialogueInput, ui.locationInput, ui.subtitleInput, ui.speakerTwoInput, ui.speakerThreeInput, ui.dialogueTwoInput, ui.dialogueThreeInput, ui.dialogueMode, ui.locationCornerInput, ui.locationOffsetInput, ui.dialogueEnabled, ui.locationEnabled, ui.positionInput, ui.widthInput, ui.flourishInput]) input.addEventListener('input', () => refreshPreview());
ui.scaleInput.addEventListener('input', () => syncScaleAcrossBatch());
ui.scaleInput.addEventListener('change', () => syncScaleAcrossBatch(true));
ui.resetPosition.addEventListener('click', () => { ui.positionInput.value = 84; refreshPreview(); });
ui.resetDialogueStyle.addEventListener('click', resetDialogueStyle);
ui.dialogueToggle.addEventListener('click', () => { savedState.collapsed.dialogue = !savedState.collapsed.dialogue; persist(); applyCollapsedState(); });
ui.locationToggle.addEventListener('click', () => { savedState.collapsed.location = !savedState.collapsed.location; persist(); applyCollapsedState(); });
ui.dialogueOverlay.addEventListener('pointerdown', startDrag); ui.dialogueOverlay.addEventListener('pointermove', moveDrag);
ui.dialogueOverlay.addEventListener('dblclick', (event) => { if (event.target.closest('.preview-editable')) return; event.preventDefault(); resetDialogueStyle(); });
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) ui.dialogueOverlay.addEventListener(event, () => { dragOffset = null; });
ui.locationTag.addEventListener('pointerdown', startLocationDrag); ui.locationTag.addEventListener('pointermove', moveLocationDrag);
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) ui.locationTag.addEventListener(event, finishLocationDrag);
for (const node of document.querySelectorAll('.preview-editable')) {
  const input = $(node.dataset.editInput);
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && input.tagName !== 'TEXTAREA') event.preventDefault();
  });
  node.addEventListener('input', () => {
    let value = node.innerText.replace(/\r/g, '');
    if (input.tagName !== 'TEXTAREA') value = value.replace(/\n+/g, ' ');
    value = value.slice(0, input.maxLength > 0 ? input.maxLength : undefined);
    if (node.innerText !== value) node.textContent = value;
    input.value = value;
    if ([ui.speakerInput, ui.speakerTwoInput, ui.speakerThreeInput].includes(input)) ui.nameTarget = input;
    refreshPreview();
  });
}
for (const event of ['dragenter', 'dragover']) ui.stage.addEventListener(event, (event) => { event.preventDefault(); ui.stage.classList.add('is-dragging'); });
for (const event of ['dragleave', 'drop']) ui.stage.addEventListener(event, (event) => { event.preventDefault(); ui.stage.classList.remove('is-dragging'); });
ui.stage.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
window.addEventListener('resize', () => { fitStage(); refreshPreview(); }); window.addEventListener('beforeunload', () => items.forEach((item) => URL.revokeObjectURL(item.url)));
applyCollapsedState(); renderNames(); applyControls(savedState.draft); renderGallery(); fitStage(); restoreImageQueue();
