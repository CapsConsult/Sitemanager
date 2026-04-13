"use client";

import {
  ChangeEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import styles from "./page.module.css";

type PDFDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;
type PdfJsModule = typeof import("pdfjs-dist");
type OverlayMode = "pins" | "spaces";
type PhotoFilter = "all" | "with-photos" | "without-photos";
type RecentFilter = "all" | "24h" | "7d";
type PinSort = "newest" | "oldest" | "page" | "photos";
type SpaceTimeFilter = "all" | "active" | "upcoming" | "past";

const PIN_STATUSES = ["to prepare", "ready", "in progress", "done", "blocked"] as const;
const WORK_TYPES = ["steel", "piping", "electrical", "insulation", "paint", "outfitting", "other"] as const;
const SPACE_STATUSES = ["free", "occupied", "blocked", "not accessible", "caution", "completed"] as const;

type PinStatus = (typeof PIN_STATUSES)[number];
type WorkType = (typeof WORK_TYPES)[number];
type SpaceStatus = (typeof SPACE_STATUSES)[number];

type StoredPhotoAttachment = { id: string; name: string };
type PhotoAttachment = StoredPhotoAttachment & { previewUrl?: string };
type PinTask = {
  title: string;
  description: string;
  status: PinStatus;
  workType: WorkType;
  materialNeeded: boolean;
  approvalNeeded: boolean;
};
type Pin = {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  photos: PhotoAttachment[];
  task: PinTask;
  createdAt: string;
};
type Space = {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  status: SpaceStatus;
  note: string;
  contractor: string;
  startAt: string;
  endAt: string;
  createdAt: string;
};
type StoredProject = { pdfName: string; hasPdf: boolean; pins: Pin[]; spaces: Space[] };
type LegacyPhotoAttachment = StoredPhotoAttachment & { dataUrl?: string };
type LegacyPin = Omit<Pin, "photos" | "task"> & {
  photos?: LegacyPhotoAttachment[];
  task?: Partial<PinTask>;
  title?: string;
  description?: string;
  status?: string;
  workType?: string;
  materialNeeded?: boolean;
  approvalNeeded?: boolean;
};
type LegacySpace = Partial<Space> & { page?: number; contractorName?: string };
type LegacyStoredProject = {
  pdfName?: string;
  pdfDataUrl?: string;
  hasPdf?: boolean;
  pins?: LegacyPin[];
  spaces?: LegacySpace[];
};
type SpaceStyle = { fill: string; border: string; text: string };
type PageCanvasProps = {
  mode: OverlayMode;
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  panEnabled: boolean;
  availableWidth: number;
  pins: Pin[];
  spaces: Space[];
  selectedPinId: string | null;
  selectedSpaceId: string | null;
  onZoomChange: (nextZoom: number) => void;
  onAddPin: (pageNumber: number, x: number, y: number) => void;
  onCreateSpace: (pageNumber: number, x: number, y: number, width: number, height: number) => void;
  onSelectPin: (pinId: string) => void;
  onSelectSpace: (spaceId: string) => void;
};

const STORAGE_KEY = "site-manager-mvp/v2";
const LEGACY_STORAGE_KEY = "site-manager-mvp/v1";
const DB_NAME = "site-manager-mvp";
const DB_VERSION = 1;
const FILE_STORE = "project-files";
const PDF_FILE_KEY = "project-pdf";
const EMPTY_PROJECT: StoredProject = { pdfName: "", hasPdf: false, pins: [], spaces: [] };
const SPACE_STATUS_STYLES: Record<SpaceStatus, SpaceStyle> = {
  free: { fill: "rgba(53,135,78,.18)", border: "rgba(53,135,78,.72)", text: "#2c6c41" },
  occupied: { fill: "rgba(190,67,67,.22)", border: "rgba(190,67,67,.82)", text: "#8e2424" },
  blocked: { fill: "rgba(164,40,40,.24)", border: "rgba(164,40,40,.84)", text: "#7a1717" },
  "not accessible": { fill: "rgba(153,41,41,.26)", border: "rgba(153,41,41,.84)", text: "#7d1e1e" },
  caution: { fill: "rgba(214,136,49,.22)", border: "rgba(214,136,49,.84)", text: "#8d5b1a" },
  completed: { fill: "rgba(55,115,161,.18)", border: "rgba(55,115,161,.78)", text: "#234f73" },
};
let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function createId() { return crypto.randomUUID(); }
function clamp01(value: number) { return Math.min(1, Math.max(0, value)); }
function isPinStatus(value: string | undefined): value is PinStatus { return Boolean(value && PIN_STATUSES.includes(value as PinStatus)); }
function isWorkType(value: string | undefined): value is WorkType { return Boolean(value && WORK_TYPES.includes(value as WorkType)); }
function isSpaceStatus(value: string | undefined): value is SpaceStatus { return Boolean(value && SPACE_STATUSES.includes(value as SpaceStatus)); }
function createDefaultTask(): PinTask { return { title: "", description: "", status: "to prepare", workType: "other", materialNeeded: false, approvalNeeded: false }; }
function createDefaultSpace(pageNumber: number, x: number, y: number, width: number, height: number): Space {
  return { id: createId(), pageNumber, x, y, width, height, name: "", status: "free", note: "", contractor: "", startAt: "", endAt: "", createdAt: new Date().toISOString() };
}
function normalizeTask(pin: LegacyPin): PinTask {
  const task = pin.task;
  const rawStatus = task?.status ?? pin.status;
  const rawWorkType = task?.workType ?? pin.workType;
  return {
    title: task?.title ?? pin.title ?? "",
    description: task?.description ?? pin.description ?? "",
    status: isPinStatus(rawStatus) ? rawStatus : "to prepare",
    workType: isWorkType(rawWorkType) ? rawWorkType : "other",
    materialNeeded: Boolean(task?.materialNeeded ?? pin.materialNeeded),
    approvalNeeded: Boolean(task?.approvalNeeded ?? pin.approvalNeeded),
  };
}
function normalizeSpace(space: LegacySpace): Space | null {
  const pageNumber = Number(space.pageNumber ?? space.page ?? 1);
  const x = Number(space.x ?? 0), y = Number(space.y ?? 0), width = Number(space.width ?? 0), height = Number(space.height ?? 0);
  if (!Number.isFinite(pageNumber) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const rawStatus = space.status;
  return {
    id: space.id ?? createId(), pageNumber: Math.max(1, Math.round(pageNumber)), x: clamp01(x), y: clamp01(y),
    width: Math.min(1, Math.max(.02, width)), height: Math.min(1, Math.max(.02, height)),
    name: space.name ?? "", status: isSpaceStatus(rawStatus) ? rawStatus : "free", note: space.note ?? "",
    contractor: space.contractor ?? space.contractorName ?? "", startAt: space.startAt ?? "", endAt: space.endAt ?? "", createdAt: space.createdAt ?? new Date().toISOString(),
  };
}
function photoFileKey(photoId: string) { return `photo:${photoId}`; }
async function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return module;
    });
  }
  return pdfJsModulePromise;
}
function openStorageDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FILE_STORE)) database.createObjectStore(FILE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open file storage."));
  });
}
async function withFileStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => Promise<T>) {
  const database = await openStorageDb();
  try {
    const store = database.transaction(FILE_STORE, mode).objectStore(FILE_STORE);
    return await action(store);
  } finally { database.close(); }
}
function wrapRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}
function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}
async function writeStoredFile(key: string, blob: Blob) { await withFileStore("readwrite", async (store) => { store.put(blob, key); await waitForTransaction(store.transaction); }); }
async function readStoredFile(key: string) { return withFileStore("readonly", async (store) => { const result = await wrapRequest(store.get(key)); return result instanceof Blob ? result : null; }); }
async function deleteStoredFile(key: string) { await withFileStore("readwrite", async (store) => { store.delete(key); await waitForTransaction(store.transaction); }); }
async function clearStoredFiles() { await withFileStore("readwrite", async (store) => { store.clear(); await waitForTransaction(store.transaction); }); }
async function dataUrlToBlob(dataUrl: string) { const response = await fetch(dataUrl); return response.blob(); }
function sanitizeStoredProject(project: LegacyStoredProject): StoredProject {
  return {
    pdfName: project.pdfName ?? "", hasPdf: Boolean(project.hasPdf),
    pins: Array.isArray(project.pins) ? project.pins.map((pin) => ({ id: pin.id, pageNumber: pin.pageNumber, x: pin.x, y: pin.y, createdAt: pin.createdAt, task: normalizeTask(pin), photos: Array.isArray(pin.photos) ? pin.photos.map((photo) => ({ id: photo.id, name: photo.name })) : [] })) : [],
    spaces: Array.isArray(project.spaces) ? project.spaces.map((space) => normalizeSpace(space)).filter((space): space is Space => space !== null) : [],
  };
}
async function migrateStoredProject(project: LegacyStoredProject) {
  const normalized = sanitizeStoredProject(project);
  const hasLegacyPdf = typeof project.pdfDataUrl === "string" && project.pdfDataUrl.length > 0;
  const hasLegacyPhotos = normalized.pins.some((pin, pinIndex) => Array.isArray(project.pins?.[pinIndex]?.photos) ? project.pins?.[pinIndex]?.photos?.some((photo) => typeof photo.dataUrl === "string") : false);
  if (!hasLegacyPdf && !hasLegacyPhotos) return normalized;
  if (hasLegacyPdf && project.pdfDataUrl) { await writeStoredFile(PDF_FILE_KEY, await dataUrlToBlob(project.pdfDataUrl)); normalized.hasPdf = true; }
  await Promise.all(normalized.pins.flatMap((pin, pinIndex) => pin.photos.map(async (photo, photoIndex) => {
    const legacyPhoto = project.pins?.[pinIndex]?.photos?.[photoIndex];
    if (!legacyPhoto?.dataUrl) return;
    await writeStoredFile(photoFileKey(photo.id), await dataUrlToBlob(legacyPhoto.dataUrl));
  })));
  return normalized;
}
async function imageFileToBlob(file: File) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => {
        const scale = Math.min(1600 / image.width, 1600 / image.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) { reject(new Error("Unable to prepare image preview.")); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Unable to prepare image preview.")), "image/jpeg", .82);
      };
      image.onerror = () => reject(new Error(`Failed to load ${file.name}`));
      image.src = sourceUrl;
    });
  } finally { URL.revokeObjectURL(sourceUrl); }
}
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function getPinLabel(pin: Pin, index: number) { return pin.task.title.trim() || `Pin ${index + 1}`; }
function getSpaceLabel(space: Space, index: number) { return space.name.trim() || `Space ${index + 1}`; }
function matchesRecentFilter(createdAt: string, filter: RecentFilter) {
  if (filter === "all") return true;
  const createdTime = new Date(createdAt).getTime();
  const hours = filter === "24h" ? 24 : 24 * 7;
  return Date.now() - createdTime <= hours * 60 * 60 * 1000;
}
function getSpaceTimeState(space: Space) {
  const now = Date.now();
  const start = space.startAt ? new Date(space.startAt).getTime() : null;
  const end = space.endAt ? new Date(space.endAt).getTime() : null;
  if (start && start > now) return "upcoming";
  if (end && end < now) return "past";
  if ((start && start <= now) || (end && end >= now)) return "active";
  return "unscheduled";
}
function matchesSpaceTimeFilter(space: Space, filter: SpaceTimeFilter) { return filter === "all" ? true : getSpaceTimeState(space) === filter; }
function toLocalDateTimeValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function fromLocalDateTimeValue(value: string) { return value ? new Date(value).toISOString() : ""; }

function PageCanvas({ mode, pdfDocument, pageNumber, zoom, panEnabled, availableWidth, pins, spaces, selectedPinId, selectedSpaceId, onZoomChange, onAddPin, onCreateSpace, onSelectPin, onSelectSpace }: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<import("pdfjs-dist").RenderTask | null>(null);
  const suppressClickRef = useRef(false);
  const pendingZoomAnchorRef = useRef<{ zoom: number; relativeX: number; relativeY: number; offsetX: number; offsetY: number } | null>(null);
  const interactionRef = useRef<{ type: "pan"; pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);
  const [aspectRatio, setAspectRatio] = useState(1.414);
  const [isRendering, setIsRendering] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [draftSpace, setDraftSpace] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const frameWidth = Math.max(availableWidth, 280);

  const baseHeight = frameWidth * aspectRatio;
  const scaledWidth = frameWidth * zoom;
  const scaledHeight = baseHeight * zoom;

  useEffect(() => {
    const pendingAnchor = pendingZoomAnchorRef.current;
    const viewport = viewportRef.current;
    if (!pendingAnchor || !viewport || pendingAnchor.zoom !== zoom) return;
    viewport.scrollLeft = pendingAnchor.relativeX * scaledWidth - pendingAnchor.offsetX;
    viewport.scrollTop = pendingAnchor.relativeY * scaledHeight - pendingAnchor.offsetY;
    pendingZoomAnchorRef.current = null;
  }, [scaledHeight, scaledWidth, zoom]);

  useEffect(() => {
    let cancelled = false;
    async function renderPage() {
      if (!canvasRef.current || !frameWidth) return;
      try {
        setIsRendering(true); setRenderError(null);
        renderTaskRef.current?.cancel();
        const page = await pdfDocument.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        if (cancelled) return;
        const nextAspectRatio = baseViewport.height / baseViewport.width;
        setAspectRatio(nextAspectRatio);
        const pixelRatio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: (scaledWidth / baseViewport.width) * pixelRatio });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas rendering is unavailable.");
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = viewport.width; canvas.height = viewport.height;
        canvas.style.width = `${scaledWidth}px`; canvas.style.height = `${scaledWidth * nextAspectRatio}px`;
        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (!cancelled) setIsRendering(false);
      } catch (error) {
        if (error instanceof Error && error.name === "RenderingCancelledException") return;
        if (!cancelled) {
          setRenderError(error instanceof Error ? error.message : "Failed to render this page.");
          setIsRendering(false);
        }
      }
    }
    void renderPage();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [frameWidth, pageNumber, pdfDocument, scaledWidth]);

  const getRelativePoint = (event: ReactPointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: clamp01((event.clientX - bounds.left) / bounds.width), y: clamp01((event.clientY - bounds.top) / bounds.height) };
  };
  const handleViewportWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = viewport.getBoundingClientRect();
    const offsetX = event.clientX - bounds.left;
    const offsetY = event.clientY - bounds.top;
    const contentX = viewport.scrollLeft + offsetX;
    const contentY = viewport.scrollTop + offsetY;
    const relativeX = scaledWidth > 0 ? contentX / scaledWidth : 0;
    const relativeY = scaledHeight > 0 ? contentY / scaledHeight : 0;
    const nextZoom = Math.min(10, Math.max(0.5, Number((zoom * Math.exp(-event.deltaY * 0.0015)).toFixed(2))));
    if (nextZoom === zoom) return;
    pendingZoomAnchorRef.current = {
      zoom: nextZoom,
      relativeX: clamp01(relativeX),
      relativeY: clamp01(relativeY),
      offsetX,
      offsetY,
    };
    onZoomChange(nextZoom);
  };
  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (panEnabled || mode !== "pins") return;
    const point = getRelativePoint(event);
    onAddPin(pageNumber, point.x, point.y);
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (panEnabled && zoom > 1 && viewportRef.current) {
      interactionRef.current = {
        type: "pan",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: viewportRef.current.scrollLeft,
        scrollTop: viewportRef.current.scrollTop,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (mode !== "spaces") return;
    const point = getRelativePoint(event);
    setDraftSpace({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (interaction?.type === "pan" && interaction.pointerId === event.pointerId && viewportRef.current) {
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        interaction.moved = true;
        suppressClickRef.current = true;
      }
      viewportRef.current.scrollLeft = interaction.scrollLeft - deltaX;
      viewportRef.current.scrollTop = interaction.scrollTop - deltaY;
      return;
    }
    if (mode !== "spaces" || !draftSpace) return;
    const point = getRelativePoint(event);
    setDraftSpace((current) => current ? { ...current, currentX: point.x, currentY: point.y } : current);
  };
  const finishDraftSpace = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (interaction?.type === "pan" && interaction.pointerId === event.pointerId) {
      interactionRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (mode !== "spaces" || !draftSpace) return;
    const point = getRelativePoint(event);
    const left = Math.min(draftSpace.startX, point.x), top = Math.min(draftSpace.startY, point.y);
    const width = Math.abs(point.x - draftSpace.startX), height = Math.abs(point.y - draftSpace.startY);
    setDraftSpace(null); event.currentTarget.releasePointerCapture(event.pointerId);
    if (width < .03 || height < .03) return;
    onCreateSpace(pageNumber, left, top, width, height);
  };
  const draftStyle = draftSpace ? {
    left: `${Math.min(draftSpace.startX, draftSpace.currentX) * 100}%`,
    top: `${Math.min(draftSpace.startY, draftSpace.currentY) * 100}%`,
    width: `${Math.abs(draftSpace.currentX - draftSpace.startX) * 100}%`,
    height: `${Math.abs(draftSpace.currentY - draftSpace.startY) * 100}%`,
  } : null;

  return (
    <section className={styles.pageCard}>
      <div className={styles.pageHeading}>
        <span className={styles.pageBadge}>Page {pageNumber}</span>
        <span className={styles.pageHint}>{mode === "pins" ? "Tap anywhere on the sheet to place a pin." : "Drag on the sheet to draw a space layer."}</span>
      </div>
      <div className={styles.pageMeasure}>
        <div
          ref={viewportRef}
          className={styles.pageViewport}
          onWheel={handleViewportWheel}
          style={{ width: `${frameWidth}px`, height: `${Math.max(baseHeight, 240)}px` }}
        >
          <div className={styles.pageFrame} style={{ width: `${scaledWidth}px`, minHeight: `${Math.max(scaledHeight, 240)}px` }}>
            <div className={`${styles.pageSurface} ${mode === "spaces" ? styles.pageSurfaceDraw : ""} ${panEnabled && zoom > 1 ? styles.pageSurfacePan : ""}`} onClick={handleCanvasClick} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={finishDraftSpace} onPointerCancel={() => { interactionRef.current = null; setDraftSpace(null); }} style={{ width: `${scaledWidth}px`, minHeight: `${Math.max(scaledHeight, 240)}px` }}>
              <canvas ref={canvasRef} className={styles.pageCanvas} />
              <div className={styles.spaceLayer}>
                {spaces.map((space, index) => {
                  const palette = SPACE_STATUS_STYLES[space.status];
                  const label = getSpaceLabel(space, index);
                  return (
                    <button key={space.id} type="button" className={`${styles.spaceButton} ${space.id === selectedSpaceId ? styles.spaceButtonSelected : ""}`} style={{ left: `${space.x * 100}%`, top: `${space.y * 100}%`, width: `${space.width * 100}%`, height: `${space.height * 100}%`, background: palette.fill, borderColor: palette.border, color: palette.text, pointerEvents: mode === "spaces" ? "auto" : "none" }} onClick={(event) => { event.stopPropagation(); onSelectSpace(space.id); }} onPointerDown={(event) => event.stopPropagation()} aria-label={`${label} on page ${pageNumber}`}>
                      <span className={styles.spaceLabel}>{label}</span>
                    </button>
                  );
                })}
                {draftStyle ? <div className={styles.spaceDraft} style={draftStyle} /> : null}
              </div>
              <div className={styles.pinLayer}>
                {pins.map((pin, index) => (
                  <button key={pin.id} type="button" className={`${styles.pinButton} ${pin.id === selectedPinId ? styles.pinButtonActive : ""}`} style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%`, pointerEvents: mode === "pins" ? "auto" : "none" }} onClick={(event) => { event.stopPropagation(); onSelectPin(pin.id); }} aria-label={`${getPinLabel(pin, index)} on page ${pageNumber}`}>{index + 1}</button>
                ))}
              </div>
              {isRendering ? <div className={styles.pageStatus}>Rendering page...</div> : null}
              {renderError ? <div className={styles.pageStatusError}>{renderError}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
export default function Home() {
  const viewerRef = useRef<HTMLElement | null>(null);
  const [project, setProject] = useState<StoredProject>(EMPTY_PROJECT);
  const [mode, setMode] = useState<OverlayMode>("pins");
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [pageFilter, setPageFilter] = useState("all");
  const [photoFilter, setPhotoFilter] = useState<PhotoFilter>("all");
  const [recentFilter, setRecentFilter] = useState<RecentFilter>("all");
  const [pinSearch, setPinSearch] = useState("");
  const [pinSort, setPinSort] = useState<PinSort>("newest");
  const [spacePageFilter, setSpacePageFilter] = useState("all");
  const [spaceStatusFilter, setSpaceStatusFilter] = useState("all");
  const [spaceContractorFilter, setSpaceContractorFilter] = useState("all");
  const [spaceTimeFilter, setSpaceTimeFilter] = useState<SpaceTimeFilter>("all");
  const [zoom, setZoom] = useState(1);
  const [panEnabled, setPanEnabled] = useState(false);
  const [viewerWidth, setViewerWidth] = useState(960);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const updateWidth = () => setViewerWidth(viewer.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function hydrateProject() {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved) as LegacyStoredProject;
        const migrated = await migrateStoredProject(parsed);
        if (!cancelled) setProject(migrated);
      } catch {
        if (!cancelled) setStorageError("Saved data could not be restored. Starting fresh.");
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    }
    void hydrateProject();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      setStorageError(null);
    } catch {
      setStorageError("Project metadata could not be saved in local storage.");
    }
  }, [isHydrated, project]);

  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      if (!project.hasPdf) {
        setPdfDocument(null); setPageCount(0); setPdfError(null); return;
      }
      try {
        setIsLoadingPdf(true); setPdfError(null);
        const file = await readStoredFile(PDF_FILE_KEY);
        if (!file) throw new Error("The saved PDF file could not be found.");
        const pdfJs = await loadPdfJs();
        const loadingTask = pdfJs.getDocument({ data: await file.arrayBuffer() });
        const document = await loadingTask.promise;
        if (!cancelled) { setPdfDocument(document); setPageCount(document.numPages); }
      } catch (error) {
        if (!cancelled) {
          setPdfDocument(null); setPageCount(0);
          setPdfError(error instanceof Error ? error.message : "The selected PDF could not be opened.");
        }
      } finally {
        if (!cancelled) setIsLoadingPdf(false);
      }
    }
    void loadPdf();
    return () => { cancelled = true; };
  }, [project.hasPdf]);

  useEffect(() => {
    if (selectedPinId && !project.pins.some((pin) => pin.id === selectedPinId)) setSelectedPinId(null);
  }, [project.pins, selectedPinId]);
  useEffect(() => {
    if (selectedSpaceId && !project.spaces.some((space) => space.id === selectedSpaceId)) setSelectedSpaceId(null);
  }, [project.spaces, selectedSpaceId]);

  const allPhotoIds = useMemo(() => new Set(project.pins.flatMap((pin) => pin.photos.map((photo) => photo.id))), [project.pins]);
  useEffect(() => {
    setPhotoUrls((current) => {
      const nextEntries = Object.entries(current).filter(([photoId]) => allPhotoIds.has(photoId));
      const removedEntries = Object.entries(current).filter(([photoId]) => !allPhotoIds.has(photoId));
      removedEntries.forEach(([, url]) => URL.revokeObjectURL(url));
      return Object.fromEntries(nextEntries);
    });
  }, [allPhotoIds]);
  useEffect(() => () => { Object.values(photoUrls).forEach((url) => URL.revokeObjectURL(url)); }, [photoUrls]);

  const selectedPin = useMemo(() => project.pins.find((pin) => pin.id === selectedPinId) ?? null, [project.pins, selectedPinId]);
  const selectedSpace = useMemo(() => project.spaces.find((space) => space.id === selectedSpaceId) ?? null, [project.spaces, selectedSpaceId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedPinPhotos() {
      if (!selectedPin) return;
      try {
        await Promise.all(selectedPin.photos.map(async (photo) => {
          if (photoUrls[photo.id]) return;
          const blob = await readStoredFile(photoFileKey(photo.id));
          if (!blob || cancelled) return;
          const objectUrl = URL.createObjectURL(blob);
          setPhotoUrls((current) => {
            if (current[photo.id]) { URL.revokeObjectURL(objectUrl); return current; }
            return { ...current, [photo.id]: objectUrl };
          });
        }));
      } catch {
        if (!cancelled) setStorageError("Some saved photos could not be restored.");
      }
    }
    void loadSelectedPinPhotos();
    return () => { cancelled = true; };
  }, [photoUrls, selectedPin]);

  const updatePin = (pinId: string, updater: (pin: Pin) => Pin) => setProject((current) => ({ ...current, pins: current.pins.map((pin) => pin.id === pinId ? updater(pin) : pin) }));
  const updateSpace = (spaceId: string, updater: (space: Space) => Space) => setProject((current) => ({ ...current, spaces: current.spaces.map((space) => space.id === spaceId ? updater(space) : space) }));

  const handlePdfUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { setPdfError("Please choose a PDF file."); return; }
    try {
      setPdfError(null);
      await clearStoredFiles();
      await writeStoredFile(PDF_FILE_KEY, file);
      setProject({ pdfName: file.name, hasPdf: true, pins: [], spaces: [] });
      setPhotoUrls((current) => { Object.values(current).forEach((url) => URL.revokeObjectURL(url)); return {}; });
      setSelectedPinId(null); setSelectedSpaceId(null);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "Failed to load that PDF.");
    } finally { event.target.value = ""; }
  };

  const addPin = (pageNumber: number, x: number, y: number) => {
    const pin: Pin = { id: createId(), pageNumber, x, y, photos: [], task: createDefaultTask(), createdAt: new Date().toISOString() };
    setProject((current) => ({ ...current, pins: [...current.pins, pin] }));
    setSelectedPinId(pin.id); setSelectedSpaceId(null);
  };

  const createSpace = (pageNumber: number, x: number, y: number, width: number, height: number) => {
    const space = createDefaultSpace(pageNumber, x, y, width, height);
    setProject((current) => ({ ...current, spaces: [...current.spaces, space] }));
    setSelectedSpaceId(space.id); setSelectedPinId(null);
  };

  const handlePhotoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length || !selectedPin) return;
    try {
      setStorageError(null);
      const photos = await Promise.all(files.map(async (file) => {
        const id = createId();
        const blob = await imageFileToBlob(file);
        await writeStoredFile(photoFileKey(id), blob);
        return { id, name: file.name, previewUrl: URL.createObjectURL(blob) };
      }));
      setPhotoUrls((current) => ({ ...current, ...Object.fromEntries(photos.map((photo) => [photo.id, photo.previewUrl] as const)) }));
      setProject((current) => ({ ...current, pins: current.pins.map((pin) => pin.id === selectedPin.id ? { ...pin, photos: [...pin.photos, ...photos.map(({ id, name }) => ({ id, name }))] } : pin) }));
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Failed to add photos.");
    } finally { event.target.value = ""; }
  };

  const updateSelectedPinTask = <K extends keyof PinTask>(field: K, value: PinTask[K]) => {
    if (!selectedPin) return;
    updatePin(selectedPin.id, (pin) => ({ ...pin, task: { ...pin.task, [field]: value } }));
  };
  const updateSelectedSpaceField = <K extends keyof Space>(field: K, value: Space[K]) => {
    if (!selectedSpace) return;
    updateSpace(selectedSpace.id, (space) => ({ ...space, [field]: value }));
  };

  const removePin = (pinId: string) => {
    const pinToRemove = project.pins.find((pin) => pin.id === pinId);
    setProject((current) => ({ ...current, pins: current.pins.filter((pin) => pin.id !== pinId) }));
    if (selectedPinId === pinId) setSelectedPinId(null);
    pinToRemove?.photos.forEach((photo) => { void deleteStoredFile(photoFileKey(photo.id)); });
  };
  const removePhoto = (pinId: string, photoId: string) => {
    setProject((current) => ({ ...current, pins: current.pins.map((pin) => pin.id === pinId ? { ...pin, photos: pin.photos.filter((photo) => photo.id !== photoId) } : pin) }));
    void deleteStoredFile(photoFileKey(photoId));
  };
  const removeSpace = (spaceId: string) => {
    setProject((current) => ({ ...current, spaces: current.spaces.filter((space) => space.id !== spaceId) }));
    if (selectedSpaceId === spaceId) setSelectedSpaceId(null);
  };
  const clearProject = () => {
    void clearStoredFiles();
    setProject(EMPTY_PROJECT);
    setPhotoUrls((current) => { Object.values(current).forEach((url) => URL.revokeObjectURL(url)); return {}; });
    setSelectedPinId(null); setSelectedSpaceId(null); setPdfDocument(null); setPageCount(0); setPdfError(null); setStorageError(null);
  };

  const pinSummary = useMemo(() => [...project.pins].sort((a, b) => a.pageNumber === b.pageNumber ? a.createdAt.localeCompare(b.createdAt) : a.pageNumber - b.pageNumber), [project.pins]);
  const pageFilterOptions = useMemo(() => Array.from(new Set([...project.pins.map((pin) => pin.pageNumber), ...project.spaces.map((space) => space.pageNumber)])).sort((a, b) => a - b).map(String), [project.pins, project.spaces]);
  const contractorOptions = useMemo(() => Array.from(new Set(project.spaces.map((space) => space.contractor.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [project.spaces]);
  const filteredPins = useMemo(() => {
    const searchTerm = pinSearch.trim().toLowerCase();
    return pinSummary.filter((pin) => {
      if (pageFilter !== "all" && String(pin.pageNumber) !== pageFilter) return false;
      if (photoFilter === "with-photos" && pin.photos.length === 0) return false;
      if (photoFilter === "without-photos" && pin.photos.length > 0) return false;
      if (!matchesRecentFilter(pin.createdAt, recentFilter)) return false;
      return searchTerm ? `${pin.task.title} ${pin.task.description}`.toLowerCase().includes(searchTerm) : true;
    }).sort((a, b) => {
      if (pinSort === "oldest") return a.createdAt.localeCompare(b.createdAt);
      if (pinSort === "page") return a.pageNumber === b.pageNumber ? a.createdAt.localeCompare(b.createdAt) : a.pageNumber - b.pageNumber;
      if (pinSort === "photos") return b.photos.length === a.photos.length ? b.createdAt.localeCompare(a.createdAt) : b.photos.length - a.photos.length;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [pageFilter, photoFilter, pinSearch, pinSort, pinSummary, recentFilter]);
  const spaceSummary = useMemo(() => [...project.spaces].sort((a, b) => a.pageNumber === b.pageNumber ? b.createdAt.localeCompare(a.createdAt) : a.pageNumber - b.pageNumber), [project.spaces]);
  const filteredSpaces = useMemo(() => spaceSummary.filter((space) => {
    if (spacePageFilter !== "all" && String(space.pageNumber) !== spacePageFilter) return false;
    if (spaceStatusFilter !== "all" && space.status !== spaceStatusFilter) return false;
    if (spaceContractorFilter !== "all" && space.contractor.trim() !== spaceContractorFilter) return false;
    return matchesSpaceTimeFilter(space, spaceTimeFilter);
  }), [spaceContractorFilter, spacePageFilter, spaceStatusFilter, spaceSummary, spaceTimeFilter]);
  const visiblePins = useMemo(() => {
    if (!selectedPin || filteredPins.some((pin) => pin.id === selectedPin.id)) return filteredPins;
    return [selectedPin, ...filteredPins];
  }, [filteredPins, selectedPin]);
  const visibleSpaces = useMemo(() => {
    if (!selectedSpace || filteredSpaces.some((space) => space.id === selectedSpace.id)) return filteredSpaces;
    return [selectedSpace, ...filteredSpaces];
  }, [filteredSpaces, selectedSpace]);
  const hasProjectData = project.hasPdf || project.pins.length > 0 || project.spaces.length > 0;
  const pages = useMemo(() => Array.from({ length: pageCount }, (_, index) => index + 1), [pageCount]);
  const zoomLabel = `${Math.round(zoom * 100)}%`;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Site Manager MVP</p>
          <h1>Pin work and mark spaces on the same drawing.</h1>
          <p className={styles.heroText}>
            Upload one PDF, switch between pin tracking and room/layer overlays, and keep the
            heavy files in IndexedDB so the app stays lightweight on mobile.
          </p>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.modeSwitch} role="tablist" aria-label="Overlay mode">
            <button
              type="button"
              className={`${styles.modeTab} ${mode === "pins" ? styles.modeTabActive : ""}`}
              onClick={() => setMode("pins")}
            >
              Pins
            </button>
            <button
              type="button"
              className={`${styles.modeTab} ${mode === "spaces" ? styles.modeTabActive : ""}`}
              onClick={() => setMode("spaces")}
            >
              Layers / Ruimtes
            </button>
          </div>
          <label className={styles.primaryAction}>
            <input type="file" accept="application/pdf" onChange={handlePdfUpload} />
            Upload PDF
          </label>
          <button
            type="button"
            className={styles.secondaryAction}
            onClick={clearProject}
            disabled={!hasProjectData}
          >
            Clear project
          </button>
        </div>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.sidebar}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Project</h2>
              <span>{mode === "pins" ? "Pin mode" : "Layer mode"}</span>
            </div>
            <p className={styles.panelHint}>
              {project.hasPdf
                ? `${project.pdfName || "PDF loaded"} is ready. ${mode === "pins" ? "Tap the drawing to place pins." : "Drag on the drawing to create rectangular spaces."}`
                : "Upload a PDF to start adding pins and spatial layers."}
            </p>
            <dl className={styles.metaList}>
              <div>
                <dt>PDF</dt>
                <dd>{project.pdfName || "Not loaded"}</dd>
              </div>
              <div>
                <dt>Pins</dt>
                <dd>{project.pins.length}</dd>
              </div>
              <div>
                <dt>Spaces</dt>
                <dd>{project.spaces.length}</dd>
              </div>
              <div>
                <dt>Pages</dt>
                <dd>{pageCount || "-"}</dd>
              </div>
            </dl>
          </section>

          {project.hasPdf ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2>Zoom</h2>
                <span>{zoomLabel}</span>
              </div>
              <p className={styles.panelHint}>
                De zoom staat los van de PDF-laag, zodat de bediening nooit mee kan schalen.
              </p>
              <div className={styles.zoomPanelActions}>
                <button
                  type="button"
                  className={styles.zoomButton}
                  onClick={() => setZoom((current) => Math.max(0.5, Number((current - 0.25).toFixed(2))))}
                  disabled={zoom <= 0.5}
                  aria-label="Zoom out"
                >
                  -
                </button>
                <button
                  type="button"
                  className={styles.zoomValue}
                  onClick={() => setZoom(1)}
                  aria-label="Reset zoom"
                >
                  {zoomLabel}
                </button>
                <button
                  type="button"
                  className={styles.zoomButton}
                  onClick={() => setZoom((current) => Math.min(10, Number((current + 0.25).toFixed(2))))}
                  disabled={zoom >= 10}
                  aria-label="Zoom in"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className={`${styles.secondaryAction} ${panEnabled ? styles.panToggleActive : ""}`}
                onClick={() => setPanEnabled((current) => !current)}
              >
                {panEnabled ? "Pan aan" : "Pan uit"}
              </button>
            </section>
          ) : null}

          {mode === "pins" ? (
            <>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>Pin Overview</h2>
                  <span>{visiblePins.length} shown</span>
                </div>
                <div className={styles.filterGrid}>
                  <div className={styles.fieldGroup}>
                    <span>Search</span>
                    <input
                      type="search"
                      value={pinSearch}
                      onChange={(event) => setPinSearch(event.target.value)}
                      placeholder="Title or note"
                    />
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldGroup}>
                      <span>Page</span>
                      <select value={pageFilter} onChange={(event) => setPageFilter(event.target.value)}>
                        <option value="all">All pages</option>
                        {pageFilterOptions.map((page) => (
                          <option key={page} value={page}>
                            Page {page}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.fieldGroup}>
                      <span>Photos</span>
                      <select
                        value={photoFilter}
                        onChange={(event) => setPhotoFilter(event.target.value as PhotoFilter)}
                      >
                        <option value="all">All pins</option>
                        <option value="with-photos">With photos</option>
                        <option value="without-photos">Without photos</option>
                      </select>
                    </label>
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldGroup}>
                      <span>Recent</span>
                      <select
                        value={recentFilter}
                        onChange={(event) => setRecentFilter(event.target.value as RecentFilter)}
                      >
                        <option value="all">Any time</option>
                        <option value="24h">Last 24h</option>
                        <option value="7d">Last 7 days</option>
                      </select>
                    </label>
                    <label className={styles.fieldGroup}>
                      <span>Sort</span>
                      <select value={pinSort} onChange={(event) => setPinSort(event.target.value as PinSort)}>
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="page">Page number</option>
                        <option value="photos">Most photos</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className={styles.overviewList}>
                  {visiblePins.length ? (
                    visiblePins.map((pin, index) => (
                      <button
                        key={pin.id}
                        type="button"
                        className={`${styles.overviewItem} ${pin.id === selectedPinId ? styles.overviewItemActive : ""}`}
                        onClick={() => {
                          setSelectedPinId(pin.id);
                          setSelectedSpaceId(null);
                        }}
                      >
                        <strong>{getPinLabel(pin, index)}</strong>
                        <div className={styles.overviewMeta}>
                          <span>Page {pin.pageNumber}</span>
                          <span>{`${Math.round(pin.x * 100)}%, ${Math.round(pin.y * 100)}%`}</span>
                          <span>{pin.photos.length} photos</span>
                        </div>
                        <div className={styles.overviewMeta}>
                          <span>{pin.task.status}</span>
                          <span>{pin.task.workType}</span>
                          <span>{formatDate(pin.createdAt)}</span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className={styles.emptyState}>No pins match the current filters yet.</p>
                  )}
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>Pin Details</h2>
                  <span>{selectedPin ? `Page ${selectedPin.pageNumber}` : "Select a pin"}</span>
                </div>
                {selectedPin ? (
                  <>
                    <p className={styles.selectedMeta}>
                      Located at {`${Math.round(selectedPin.x * 100)}%, ${Math.round(selectedPin.y * 100)}%`} and created{" "}
                      {formatDate(selectedPin.createdAt)}.
                    </p>
                    <div className={styles.taskForm}>
                      <label className={styles.fieldGroup}>
                        <span>Title</span>
                        <input
                          type="text"
                          value={selectedPin.task.title}
                          onChange={(event) => updateSelectedPinTask("title", event.target.value)}
                          placeholder="Pin title"
                        />
                      </label>
                      <label className={styles.fieldGroup}>
                        <span>Description</span>
                        <textarea
                          rows={4}
                          value={selectedPin.task.description}
                          onChange={(event) => updateSelectedPinTask("description", event.target.value)}
                          placeholder="Short task note"
                        />
                      </label>
                      <div className={styles.fieldRow}>
                        <label className={styles.fieldGroup}>
                          <span>Status</span>
                          <select
                            value={selectedPin.task.status}
                            onChange={(event) => updateSelectedPinTask("status", event.target.value as PinStatus)}
                          >
                            {PIN_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.fieldGroup}>
                          <span>Discipline</span>
                          <select
                            value={selectedPin.task.workType}
                            onChange={(event) => updateSelectedPinTask("workType", event.target.value as WorkType)}
                          >
                            {WORK_TYPES.map((workType) => (
                              <option key={workType} value={workType}>
                                {workType}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className={styles.checkRow}>
                        <label className={styles.checkboxField}>
                          <input
                            type="checkbox"
                            checked={selectedPin.task.materialNeeded}
                            onChange={(event) =>
                              updateSelectedPinTask("materialNeeded", event.target.checked)
                            }
                          />
                          <span>Material needed</span>
                        </label>
                        <label className={styles.checkboxField}>
                          <input
                            type="checkbox"
                            checked={selectedPin.task.approvalNeeded}
                            onChange={(event) =>
                              updateSelectedPinTask("approvalNeeded", event.target.checked)
                            }
                          />
                          <span>Approval needed</span>
                        </label>
                      </div>
                    </div>

                    <div className={styles.photoSection}>
                      <div className={styles.panelHeader}>
                        <h3>Photos</h3>
                        <span>{selectedPin.photos.length}</span>
                      </div>
                      <label className={styles.secondaryAction}>
                        <input type="file" accept="image/*" multiple onChange={handlePhotoUpload} />
                        Add photos
                      </label>
                      <div className={styles.photoGrid}>
                        {selectedPin.photos.length ? (
                          selectedPin.photos.map((photo) => (
                            <article key={photo.id} className={styles.photoCard}>
                              <div className={styles.photoFrame}>
                                {photoUrls[photo.id] ? (
                                  <Image
                                    src={photoUrls[photo.id]}
                                    alt={photo.name}
                                    fill
                                    sizes="(max-width: 768px) 50vw, 160px"
                                  />
                                ) : (
                                  <div className={styles.photoPlaceholder}>Loading...</div>
                                )}
                              </div>
                              <div className={styles.photoMeta}>
                                <span>{photo.name}</span>
                                <button
                                  type="button"
                                  className={styles.photoRemove}
                                  onClick={() => removePhoto(selectedPin.id, photo.id)}
                                >
                                  Remove
                                </button>
                              </div>
                            </article>
                          ))
                        ) : (
                          <p className={styles.emptyState}>No photos attached to this pin yet.</p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className={styles.secondaryAction}
                      onClick={() => removePin(selectedPin.id)}
                    >
                      Delete pin
                    </button>
                  </>
                ) : (
                  <p className={styles.emptyState}>Select a pin from the list or tap the PDF to create one.</p>
                )}
              </section>
            </>
          ) : (
            <>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>Space Overview</h2>
                  <span>{visibleSpaces.length} shown</span>
                </div>
                <div className={styles.filterGrid}>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldGroup}>
                      <span>Page</span>
                      <select
                        value={spacePageFilter}
                        onChange={(event) => setSpacePageFilter(event.target.value)}
                      >
                        <option value="all">All pages</option>
                        {pageFilterOptions.map((page) => (
                          <option key={page} value={page}>
                            Page {page}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.fieldGroup}>
                      <span>Status</span>
                      <select
                        value={spaceStatusFilter}
                        onChange={(event) => setSpaceStatusFilter(event.target.value)}
                      >
                        <option value="all">All statuses</option>
                        {SPACE_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldGroup}>
                      <span>Contractor</span>
                      <select
                        value={spaceContractorFilter}
                        onChange={(event) => setSpaceContractorFilter(event.target.value)}
                      >
                        <option value="all">All contractors</option>
                        {contractorOptions.map((contractor) => (
                          <option key={contractor} value={contractor}>
                            {contractor}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.fieldGroup}>
                      <span>Time</span>
                      <select
                        value={spaceTimeFilter}
                        onChange={(event) => setSpaceTimeFilter(event.target.value as SpaceTimeFilter)}
                      >
                        <option value="all">All</option>
                        <option value="active">Active now</option>
                        <option value="upcoming">Upcoming</option>
                        <option value="past">Past</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className={styles.overviewList}>
                  {visibleSpaces.length ? (
                    visibleSpaces.map((space, index) => (
                      <button
                        key={space.id}
                        type="button"
                        className={`${styles.overviewItem} ${space.id === selectedSpaceId ? styles.overviewItemActive : ""}`}
                        onClick={() => {
                          setSelectedSpaceId(space.id);
                          setSelectedPinId(null);
                        }}
                      >
                        <strong>{getSpaceLabel(space, index)}</strong>
                        <div className={styles.overviewMeta}>
                          <span>Page {space.pageNumber}</span>
                          <span>{`${Math.round(space.x * 100)}%, ${Math.round(space.y * 100)}%`}</span>
                          <span>{space.status}</span>
                        </div>
                        <div className={styles.overviewMeta}>
                          <span>{space.contractor || "No contractor"}</span>
                          <span>{getSpaceTimeState(space)}</span>
                          <span>{formatDate(space.createdAt)}</span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className={styles.emptyState}>No spaces match the current filters yet.</p>
                  )}
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>Space Details</h2>
                  <span>{selectedSpace ? `Page ${selectedSpace.pageNumber}` : "Select a space"}</span>
                </div>
                {selectedSpace ? (
                  <>
                    <p className={styles.selectedMeta}>
                      Rectangle at {`${Math.round(selectedSpace.x * 100)}%, ${Math.round(selectedSpace.y * 100)}%`} with size{" "}
                      {`${Math.round(selectedSpace.width * 100)}% x ${Math.round(selectedSpace.height * 100)}%`}.
                    </p>
                    <div className={styles.taskForm}>
                      <label className={styles.fieldGroup}>
                        <span>Name</span>
                        <input
                          type="text"
                          value={selectedSpace.name}
                          onChange={(event) => updateSelectedSpaceField("name", event.target.value)}
                          placeholder="Room or area name"
                        />
                      </label>
                      <div className={styles.fieldRow}>
                        <label className={styles.fieldGroup}>
                          <span>Status</span>
                          <select
                            value={selectedSpace.status}
                            onChange={(event) =>
                              updateSelectedSpaceField("status", event.target.value as SpaceStatus)
                            }
                          >
                            {SPACE_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.fieldGroup}>
                          <span>Contractor</span>
                          <input
                            type="text"
                            value={selectedSpace.contractor}
                            onChange={(event) =>
                              updateSelectedSpaceField("contractor", event.target.value)
                            }
                            placeholder="Subcontractor or crew"
                          />
                        </label>
                      </div>
                      <label className={styles.fieldGroup}>
                        <span>Note</span>
                        <textarea
                          rows={4}
                          value={selectedSpace.note}
                          onChange={(event) => updateSelectedSpaceField("note", event.target.value)}
                          placeholder="Why this area is blocked, occupied, or free"
                        />
                      </label>
                      <div className={styles.fieldRow}>
                        <label className={styles.fieldGroup}>
                          <span>Start</span>
                          <input
                            type="datetime-local"
                            value={toLocalDateTimeValue(selectedSpace.startAt)}
                            onChange={(event) =>
                              updateSelectedSpaceField(
                                "startAt",
                                fromLocalDateTimeValue(event.target.value),
                              )
                            }
                          />
                        </label>
                        <label className={styles.fieldGroup}>
                          <span>End</span>
                          <input
                            type="datetime-local"
                            value={toLocalDateTimeValue(selectedSpace.endAt)}
                            onChange={(event) =>
                              updateSelectedSpaceField(
                                "endAt",
                                fromLocalDateTimeValue(event.target.value),
                              )
                            }
                          />
                        </label>
                      </div>
                    </div>

                    <button
                      type="button"
                      className={styles.secondaryAction}
                      onClick={() => removeSpace(selectedSpace.id)}
                    >
                      Delete space
                    </button>
                  </>
                ) : (
                  <p className={styles.emptyState}>Switch to Layers mode and drag on the PDF to create a space.</p>
                )}
              </section>
            </>
          )}

          {pdfError || storageError ? (
            <section className={styles.errorPanel}>
              <h2>Storage notice</h2>
              {pdfError ? <p>{pdfError}</p> : null}
              {storageError ? <p>{storageError}</p> : null}
            </section>
          ) : null}
        </aside>

        <section className={styles.viewer} ref={viewerRef}>
          {!project.hasPdf ? (
            <div className={styles.viewerEmpty}>
              <h2>Upload a PDF to begin</h2>
              <p>Pins and spaces are placed with relative coordinates, so they stay aligned when the layout resizes.</p>
            </div>
          ) : isLoadingPdf || !pdfDocument ? (
            <div className={styles.viewerEmpty}>
              <h2>Preparing PDF</h2>
              <p>The drawing is loading from IndexedDB.</p>
            </div>
          ) : (
            <div className={styles.viewerStack}>
              {pages.map((pageNumber) => (
                <PageCanvas
                  key={pageNumber}
                  mode={mode}
                  pdfDocument={pdfDocument}
                  pageNumber={pageNumber}
                  zoom={zoom}
                  panEnabled={panEnabled}
                  availableWidth={viewerWidth}
                  onZoomChange={setZoom}
                  pins={project.pins.filter((pin) => pin.pageNumber === pageNumber)}
                  spaces={project.spaces.filter((space) => space.pageNumber === pageNumber)}
                  selectedPinId={selectedPinId}
                  selectedSpaceId={selectedSpaceId}
                  onAddPin={addPin}
                  onCreateSpace={createSpace}
                  onSelectPin={(pinId) => {
                    setSelectedPinId(pinId);
                    setSelectedSpaceId(null);
                  }}
                  onSelectSpace={(spaceId) => {
                    setSelectedSpaceId(spaceId);
                    setSelectedPinId(null);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
