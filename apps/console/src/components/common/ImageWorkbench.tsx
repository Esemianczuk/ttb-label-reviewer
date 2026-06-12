import { CloseOutlined, ExpandOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import { Button, Space, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";
import type { LabelImage } from "../../domain/application/types";

type Props = {
  image?: LabelImage;
};

const DEFAULT_ZOOM = 0.85;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;

export function ImageWorkbench({ image }: Props) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [image?.id, image?.url]);
  if (!image) return <div className="empty-panel">No image attached.</div>;
  return (
    <>
      <div className="image-card">
        <div className="image-card-toolbar">
          <div>
            <strong>{image.name}</strong>
            <span>{image.role.replace("_", " ")}</span>
          </div>
          <Tooltip title="Expand image viewer">
            <Button aria-label="Expand image viewer" className="image-expand-button" icon={<ExpandOutlined />} onClick={() => setViewerOpen(true)}>
              Expand
            </Button>
          </Tooltip>
        </div>
        {imageFailed ? (
          <div className="image-card-fallback">
            <strong>Label image unavailable</strong>
            <span>Reset the demo or re-upload the image to refresh this packet.</span>
          </div>
        ) : (
          <Tooltip title="Click the label image to expand. Drag inside the viewer to pan; use the mouse wheel to zoom.">
            <button type="button" className="image-card-preview" aria-label={`Expand ${image.name}`} onClick={() => setViewerOpen(true)}>
              <img src={image.url} alt={`${image.name} evidence`} onError={() => setImageFailed(true)} draggable={false} />
              <span className="image-card-hover-hint">
                <ExpandOutlined /> Expand image
              </span>
            </button>
          </Tooltip>
        )}
      </div>
      <FloatingImageViewer image={image} open={viewerOpen} onClose={() => setViewerOpen(false)} />
    </>
  );
}

export function FloatingImageViewer({
  image,
  imageOptions,
  open,
  onClose,
  onImageChange
}: {
  image: LabelImage;
  imageOptions?: LabelImage[];
  open: boolean;
  onClose: () => void;
  onImageChange?: (image: LabelImage) => void;
}) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [position, setPosition] = useState(defaultViewerPosition);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [imageFailed, setImageFailed] = useState(false);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const clearDrag = () => {
    dragRef.current = null;
  };
  const clearPan = () => {
    panRef.current = null;
  };
  const adjustZoom = (direction: 1 | -1) => {
    setZoom((value) => clampZoom(value + direction * ZOOM_STEP));
  };

  useEffect(() => {
    setImageFailed(false);
  }, [image.id, image.url]);

  useEffect(() => {
    if (!open) return;
    setZoom(DEFAULT_ZOOM);
    setPan({ x: 0, y: 0 });
    setPosition(defaultViewerPosition());
  }, [image.id, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    document.body.classList.add("floating-viewer-scroll-lock");
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target;
      if (target instanceof Node && viewerRef.current?.contains(target)) {
        setZoom((value) => clampZoom(value + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
      }
    };
    const stopMiddleMouseDefault = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    };
    backdrop.addEventListener("wheel", onWheel, { passive: false, capture: true });
    backdrop.addEventListener("mousedown", stopMiddleMouseDefault, { capture: true });
    backdrop.addEventListener("auxclick", stopMiddleMouseDefault, { capture: true });
    return () => {
      backdrop.removeEventListener("wheel", onWheel, { capture: true });
      backdrop.removeEventListener("mousedown", stopMiddleMouseDefault, { capture: true });
      backdrop.removeEventListener("auxclick", stopMiddleMouseDefault, { capture: true });
      document.body.classList.remove("floating-viewer-scroll-lock");
    };
  }, [open]);

  if (!open) return null;
  const pickerImages = (imageOptions || []).filter(Boolean);

  return (
    <div
      ref={backdropRef}
      className="floating-viewer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={viewerRef}
        className="floating-viewer"
        role="dialog"
        aria-label="Expanded label image viewer"
        aria-modal="true"
        style={{ left: position.x, top: position.y }}
      >
        <div>
          <div
            className="floating-viewer-header"
            onPointerDown={(event) => {
              if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
              dragRef.current = { startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y };
              (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!dragRef.current) return;
              setPosition({
                x: Math.max(12, dragRef.current.originX + event.clientX - dragRef.current.startX),
                y: Math.max(12, dragRef.current.originY + event.clientY - dragRef.current.startY)
              });
            }}
            onPointerUp={clearDrag}
            onPointerCancel={clearDrag}
            onLostPointerCapture={clearDrag}
          >
            <strong>Drag to move view</strong>
            <Space.Compact className="floating-viewer-controls">
              <Tooltip title="Zoom out">
                <Button aria-label="Zoom out" icon={<ZoomOutOutlined />} onClick={() => adjustZoom(-1)} />
              </Tooltip>
              <span className="zoom-meter">{Math.round(zoom * 100)}%</span>
              <Tooltip title="Zoom in">
                <Button aria-label="Zoom in" icon={<ZoomInOutlined />} onClick={() => adjustZoom(1)} />
              </Tooltip>
            </Space.Compact>
            <Tooltip title="Close expanded viewer">
              <Button aria-label="Close expanded viewer" className="floating-viewer-close" icon={<CloseOutlined />} onClick={onClose} />
            </Tooltip>
          </div>
        </div>
        {pickerImages.length > 1 ? (
          <div className="floating-viewer-picker" aria-label="Choose label image to review">
            {pickerImages.map((candidate, index) => (
              <button
                type="button"
                key={candidate.id}
                className={candidate.id === image.id ? "floating-viewer-picker-item floating-viewer-picker-item-active" : "floating-viewer-picker-item"}
                aria-label={`Show image ${index + 1}: ${candidate.role.replace("_", " ")}`}
                onClick={() => onImageChange?.(candidate)}
              >
                <span>{candidate.role.replace("_", " ")}</span>
                <small>{index + 1}</small>
              </button>
            ))}
          </div>
        ) : null}
        <div
          className="floating-viewer-canvas"
          aria-label="Pan and zoom image area"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            panRef.current = { startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y };
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!panRef.current) return;
            setPan({
              x: panRef.current.originX + event.clientX - panRef.current.startX,
              y: panRef.current.originY + event.clientY - panRef.current.startY
            });
          }}
          onPointerUp={clearPan}
          onPointerCancel={clearPan}
          onLostPointerCapture={clearPan}
        >
          {imageFailed ? (
            <div className="image-card-fallback">
              <strong>Label image unavailable</strong>
              <span>Reset the demo or re-upload the image to refresh this packet.</span>
            </div>
          ) : (
            <img
              src={image.url}
              alt={`${image.name} expanded evidence`}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
              onError={() => setImageFailed(true)}
              draggable={false}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function defaultViewerPosition() {
  if (typeof window === "undefined") return { x: 280, y: 48 };
  const width = Math.min(1230, window.innerWidth - 48);
  return {
    x: Math.max(24, Math.round((window.innerWidth - width) / 2)),
    y: 48
  };
}
