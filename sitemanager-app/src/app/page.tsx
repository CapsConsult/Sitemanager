"use client";

import {
  ChangeEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import type { PDFDocumentProxy } from "pdfjs-dist";
import styles from "./page.module.css";

type PhotoAttachment = {
  id: string;
  name: string;
  dataUrl: string;
};

type Pin = {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  photos: PhotoAttachment[];
  createdAt: string;
};

type StoredProject = {
  pdfName: string;
  pdfDataUrl: string;
  pins: Pin[];
};

type PageCanvasProps = {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  pins: Pin[];
  selectedPinId: string | null;
  isPinMode: boolean;
  onAddPin: (pageNumber: number, x: number, y: number) => void;
  onSelectPin: (pinId: string) => void;
};

const STORAGE_KEY = "site-manager-mvp/v1";
const EMPTY_PROJECT: StoredProject = {
  pdfName: "",
  pdfDataUrl: "",
  pins: [],
};

function createId() {
  return crypto.randomUUID();
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function imageFileToDataUrl(file: File) {
  const fileDataUrl = await readFileAsDataUrl(file);

  return new Promise<string>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      const maxDimension = 1600;
      const scale = Math.min(maxDimension / image.width, maxDimension / image.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));

      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Unable to prepare image preview."));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => reject(new Error(`Failed to load ${file.name}`));
    image.src = fileDataUrl;
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function PageCanvas({
  pdfDocument,
  pageNumber,
  pins,
  selectedPinId,
  isPinMode,
  onAddPin,
  onSelectPin,
}: PageCanvasProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(1.414);
  const [isRendering, setIsRendering] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const updateSize = () => {
      setFrameWidth(frame.clientWidth);
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      if (!canvasRef.current || !frameWidth) {
        return;
      }

      try {
        setIsRendering(true);
        setRenderError(null);

        const page = await pdfDocument.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        if (cancelled) {
          return;
        }

        const nextAspectRatio = baseViewport.height / baseViewport.width;
        setAspectRatio(nextAspectRatio);

        const pixelRatio = window.devicePixelRatio || 1;
        const scale = (frameWidth / baseViewport.width) * pixelRatio;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("Canvas rendering is unavailable.");
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${frameWidth}px`;
        canvas.style.height = `${frameWidth * nextAspectRatio}px`;

        const renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
        });

        await renderTask.promise;
        if (!cancelled) {
          setIsRendering(false);
        }
      } catch (error) {
        if (!cancelled) {
          setRenderError(
            error instanceof Error ? error.message : "Failed to render this page.",
          );
          setIsRendering(false);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
    };
  }, [frameWidth, pageNumber, pdfDocument]);

  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!isPinMode) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    onAddPin(pageNumber, x, y);
  };

  return (
    <section className={styles.pageCard}>
      <div className={styles.pageHeading}>
        <span className={styles.pageBadge}>Page {pageNumber}</span>
        <span className={styles.pageHint}>
          {isPinMode
            ? "Pin mode is on. Tap anywhere on the sheet to place a pin."
            : "Pin mode is off. Turn it on to place pins."}
        </span>
      </div>
      <div className={styles.pageFrame} ref={frameRef}>
        <div
          className={styles.pageSurface}
          onClick={handleCanvasClick}
          style={{ minHeight: `${Math.max(frameWidth * aspectRatio, 240)}px` }}
        >
          <canvas ref={canvasRef} className={styles.pageCanvas} />
          <div className={styles.pinLayer}>
            {pins.map((pin, index) => (
              <button
                key={pin.id}
                type="button"
                className={`${styles.pinButton} ${pin.id === selectedPinId ? styles.pinButtonActive : ""}`}
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectPin(pin.id);
                }}
                aria-label={`Pin ${index + 1} on page ${pageNumber}`}
              >
                {index + 1}
              </button>
            ))}
          </div>
          {isRendering ? <div className={styles.pageStatus}>Rendering page...</div> : null}
          {renderError ? <div className={styles.pageStatusError}>{renderError}</div> : null}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [project, setProject] = useState<StoredProject>(EMPTY_PROJECT);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [isPinMode, setIsPinMode] = useState(false);
  const [getDocumentFn, setGetDocumentFn] = useState<
    | ((source: { data: ArrayBuffer }) => { promise: Promise<PDFDocumentProxy> })
    | null
  >(null);
  const [undoState, setUndoState] = useState<{
    message: string;
    undo: () => void;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPdfModule() {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      if (!cancelled) {
        setGetDocumentFn(() => pdfjs.getDocument);
      }
    }

    void loadPdfModule();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!undoState) {
      return;
    }

    const timer = window.setTimeout(() => {
      setUndoState(null);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [undoState]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as StoredProject;
        setProject({
          pdfName: parsed.pdfName ?? "",
          pdfDataUrl: parsed.pdfDataUrl ?? "",
          pins: Array.isArray(parsed.pins) ? parsed.pins : [],
        });
      }
    } catch {
      setStorageError("Saved data could not be restored. Starting fresh.");
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      setStorageError(null);
    } catch {
      setStorageError(
        "This browser ran out of local storage space. Try using a smaller PDF or fewer photos.",
      );
    }
  }, [isHydrated, project]);

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      if (!project.pdfDataUrl) {
        setPdfDocument(null);
        setPageCount(0);
        setPdfError(null);
        return;
      }

      if (!getDocumentFn) {
        return;
      }

      try {
        setIsLoadingPdf(true);
        setPdfError(null);

        const data = await fetch(project.pdfDataUrl).then((response) => response.arrayBuffer());
        const loadingTask = getDocumentFn({ data });
        const document = await loadingTask.promise;

        if (!cancelled) {
          setPdfDocument(document);
          setPageCount(document.numPages);
        }
      } catch (error) {
        if (!cancelled) {
          setPdfDocument(null);
          setPageCount(0);
          setPdfError(
            error instanceof Error ? error.message : "The selected PDF could not be opened.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPdf(false);
        }
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
    };
  }, [getDocumentFn, project.pdfDataUrl]);

  useEffect(() => {
    if (!selectedPinId) {
      return;
    }

    const stillExists = project.pins.some((pin) => pin.id === selectedPinId);
    if (!stillExists) {
      setSelectedPinId(null);
    }
  }, [project.pins, selectedPinId]);

  const selectedPin = useMemo(
    () => project.pins.find((pin) => pin.id === selectedPinId) ?? null,
    [project.pins, selectedPinId],
  );

  const handlePdfUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (file.type !== "application/pdf") {
      setPdfError("Please choose a PDF file.");
      return;
    }

    try {
      setPdfError(null);
      const dataUrl = await readFileAsDataUrl(file);
      setProject({
        pdfName: file.name,
        pdfDataUrl: dataUrl,
        pins: [],
      });
      setSelectedPinId(null);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "Failed to load that PDF.");
    } finally {
      event.target.value = "";
    }
  };

  const addPin = (pageNumber: number, x: number, y: number) => {
    const pin: Pin = {
      id: createId(),
      pageNumber,
      x,
      y,
      photos: [],
      createdAt: new Date().toISOString(),
    };

    setProject((current) => ({
      ...current,
      pins: [...current.pins, pin],
    }));
    setSelectedPinId(pin.id);
  };

  const handlePhotoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length || !selectedPin) {
      return;
    }

    try {
      const photos = await Promise.all(
        files.map(async (file) => ({
          id: createId(),
          name: file.name,
          dataUrl: await imageFileToDataUrl(file),
        })),
      );

      setProject((current) => ({
        ...current,
        pins: current.pins.map((pin) =>
          pin.id === selectedPin.id
            ? { ...pin, photos: [...pin.photos, ...photos] }
            : pin,
        ),
      }));
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Failed to add photos.");
    } finally {
      event.target.value = "";
    }
  };

  const removePin = (pinId: string) => {
    const pinIndex = project.pins.findIndex((pin) => pin.id === pinId);
    const pinToDelete = pinIndex >= 0 ? project.pins[pinIndex] : null;
    if (!pinToDelete) {
      return;
    }

    setProject((current) => ({
      ...current,
      pins: current.pins.filter((pin) => pin.id !== pinId),
    }));
    if (selectedPinId === pinId) {
      setSelectedPinId(null);
    }

    setUndoState({
      message: "Pin deleted.",
      undo: () => {
        setProject((current) => {
          const pins = [...current.pins];
          pins.splice(pinIndex, 0, pinToDelete);
          return { ...current, pins };
        });
        setSelectedPinId(pinToDelete.id);
      },
    });
  };

  const removePhoto = (pinId: string, photoId: string) => {
    const pin = project.pins.find((entry) => entry.id === pinId);
    const photoIndex = pin?.photos.findIndex((photo) => photo.id === photoId) ?? -1;
    const photoToDelete = photoIndex >= 0 && pin ? pin.photos[photoIndex] : null;
    if (!pin || !photoToDelete) {
      return;
    }

    setProject((current) => ({
      ...current,
      pins: current.pins.map((pin) =>
        pin.id === pinId
          ? {
              ...pin,
              photos: pin.photos.filter((photo) => photo.id !== photoId),
            }
          : pin,
        ),
    }));

    setUndoState({
      message: "Photo removed.",
      undo: () => {
        setProject((current) => ({
          ...current,
          pins: current.pins.map((entry) => {
            if (entry.id !== pinId) {
              return entry;
            }

            const photos = [...entry.photos];
            photos.splice(photoIndex, 0, photoToDelete);
            return { ...entry, photos };
          }),
        }));
      },
    });
  };

  const clearProject = () => {
    const shouldClear = window.confirm(
      "Clear the saved project? This removes the PDF, pins, and attached photos.",
    );
    if (!shouldClear) {
      return;
    }

    setProject(EMPTY_PROJECT);
    setSelectedPinId(null);
    setPdfDocument(null);
    setPageCount(0);
    setPdfError(null);
    setUndoState(null);
  };

  const pinSummary = useMemo(
    () =>
      [...project.pins].sort((a, b) => {
        if (a.pageNumber === b.pageNumber) {
          return a.createdAt.localeCompare(b.createdAt);
        }
        return a.pageNumber - b.pageNumber;
      }),
    [project.pins],
  );

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Site Manager MVP</p>
          <h1>Upload a PDF, drop pins, and attach photos right on the drawing.</h1>
          <p className={styles.heroText}>
            Everything stays in this browser with relative pin coordinates and local storage
            persistence. It is intentionally small, quick to use, and mobile-friendly.
          </p>
        </div>
        <div className={styles.heroActions}>
          <label className={styles.primaryAction}>
            <input type="file" accept="application/pdf" onChange={handlePdfUpload} />
            <span>{project.pdfDataUrl ? "Replace PDF" : "Upload PDF"}</span>
          </label>
          <button
            type="button"
            className={styles.secondaryAction}
            onClick={() => setIsPinMode((current) => !current)}
            aria-pressed={isPinMode}
          >
            Pin mode: {isPinMode ? "On" : "Off"}
          </button>
          <button type="button" className={styles.secondaryAction} onClick={clearProject}>
            Clear saved project
          </button>
        </div>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.panel}>
            <h2>Project</h2>
            <dl className={styles.metaList}>
              <div>
                <dt>PDF</dt>
                <dd>{project.pdfName || "Nothing uploaded yet"}</dd>
              </div>
              <div>
                <dt>Pages</dt>
                <dd>{pageCount || "-"}</dd>
              </div>
              <div>
                <dt>Pins</dt>
                <dd>{project.pins.length}</dd>
              </div>
            </dl>
            <p className={styles.panelHint}>
              Pins are stored as percentages of each page, so they stay aligned when the layout
              resizes on phones or desktops.
            </p>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Pins</h2>
              <span>{project.pins.length} total</span>
            </div>
            {pinSummary.length ? (
              <div className={styles.pinList}>
                {pinSummary.map((pin, index) => (
                  <button
                    key={pin.id}
                    type="button"
                    className={`${styles.pinListItem} ${pin.id === selectedPinId ? styles.pinListItemActive : ""}`}
                    onClick={() => setSelectedPinId(pin.id)}
                  >
                    <strong>Pin {index + 1}</strong>
                    <span>Page {pin.pageNumber}</span>
                    <span>
                      {Math.round(pin.x * 100)}%, {Math.round(pin.y * 100)}%
                    </span>
                    <span>{pin.photos.length} photo(s)</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.emptyState}>Upload a PDF and tap a page to create your first pin.</p>
            )}
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Selected pin</h2>
              {selectedPin ? <span>Page {selectedPin.pageNumber}</span> : null}
            </div>
            {selectedPin ? (
              <>
                <p className={styles.selectedMeta}>
                  Created {formatDate(selectedPin.createdAt)} at {Math.round(selectedPin.x * 100)}%,{" "}
                  {Math.round(selectedPin.y * 100)}%
                </p>
                <label className={styles.primaryAction}>
                  <input type="file" accept="image/*" multiple onChange={handlePhotoUpload} />
                  <span>Add photo(s)</span>
                </label>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={() => removePin(selectedPin.id)}
                >
                  Delete pin
                </button>
                <div className={styles.photoGrid}>
                  {selectedPin.photos.length ? (
                    selectedPin.photos.map((photo) => (
                      <article key={photo.id} className={styles.photoCard}>
                        <div className={styles.photoPreviewWrap}>
                          <Image
                            src={photo.dataUrl}
                            alt={photo.name}
                            className={styles.photoPreview}
                            fill
                            sizes="(max-width: 640px) 100vw, 320px"
                            unoptimized
                          />
                        </div>
                        <div className={styles.photoMeta}>
                          <span title={photo.name}>{photo.name}</span>
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
                    <p className={styles.emptyState}>Add one or more photos to document this pin.</p>
                  )}
                </div>
              </>
            ) : (
              <p className={styles.emptyState}>
                Choose a pin from the sheet or the list to manage attached photos.
              </p>
            )}
          </div>

          {(pdfError || storageError) && (
            <div className={styles.errorPanel}>
              {pdfError ? <p>{pdfError}</p> : null}
              {storageError ? <p>{storageError}</p> : null}
            </div>
          )}
        </aside>

        <section className={styles.viewer}>
          {!project.pdfDataUrl ? (
            <div className={styles.viewerEmpty}>
              <h2>No PDF loaded</h2>
              <p>Use the upload button to start a lightweight local markup session.</p>
            </div>
          ) : null}

          {isLoadingPdf ? <div className={styles.viewerEmpty}>Loading PDF...</div> : null}

          {pdfDocument && !isLoadingPdf ? (
            <div className={styles.pageStack}>
              {Array.from({ length: pageCount }, (_, index) => {
                const pageNumber = index + 1;
                return (
                  <PageCanvas
                    key={pageNumber}
                    pdfDocument={pdfDocument}
                    pageNumber={pageNumber}
                    pins={project.pins.filter((pin) => pin.pageNumber === pageNumber)}
                    selectedPinId={selectedPinId}
                    isPinMode={isPinMode}
                    onAddPin={addPin}
                    onSelectPin={setSelectedPinId}
                  />
                );
              })}
            </div>
          ) : null}
        </section>
      </section>
      {undoState ? (
        <div className={styles.undoToast} role="status" aria-live="polite">
          <span>{undoState.message}</span>
          <button
            type="button"
            className={styles.undoAction}
            onClick={() => {
              undoState.undo();
              setUndoState(null);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </main>
  );
}
