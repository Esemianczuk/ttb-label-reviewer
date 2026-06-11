import { CompressOutlined, ExpandOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import { Button, Space, Tooltip } from "antd";
import { useRef, useState } from "react";
import type { LabelImage } from "../../domain/application/types";

type Props = {
  image?: LabelImage;
};

export function ImageWorkbench({ image }: Props) {
  const [viewerOpen, setViewerOpen] = useState(false);
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
            <Button aria-label="Expand image viewer" icon={<ExpandOutlined />} onClick={() => setViewerOpen(true)} />
          </Tooltip>
        </div>
        <img src={image.url} alt={`${image.name} evidence`} />
      </div>
      <FloatingImageViewer image={image} open={viewerOpen} onClose={() => setViewerOpen(false)} />
    </>
  );
}

function FloatingImageViewer({ image, open, onClose }: { image: LabelImage; open: boolean; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 430, y: 72 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  if (!open) return null;

  return (
    <section
      className="floating-viewer"
      role="dialog"
      aria-label="Expanded label image viewer"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="floating-viewer-header"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
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
        onPointerUp={() => {
          dragRef.current = null;
        }}
      >
        <div>
          <strong>{image.name}</strong>
          <span>Drag header to move</span>
        </div>
        <Space>
          <Tooltip title="Zoom out">
            <Button aria-label="Zoom out" icon={<ZoomOutOutlined />} onClick={() => setZoom((value) => Math.max(0.5, value - 0.2))} />
          </Tooltip>
          <span className="zoom-meter">{Math.round(zoom * 100)}%</span>
          <Tooltip title="Zoom in">
            <Button aria-label="Zoom in" icon={<ZoomInOutlined />} onClick={() => setZoom((value) => Math.min(4, value + 0.2))} />
          </Tooltip>
          <Tooltip title="Close expanded viewer">
            <Button aria-label="Close expanded viewer" icon={<CompressOutlined />} onClick={onClose} />
          </Tooltip>
        </Space>
      </div>
      <div
        className="floating-viewer-canvas"
        onPointerDown={(event) => {
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
        onPointerUp={() => {
          panRef.current = null;
        }}
      >
        <img
          src={image.url}
          alt={`${image.name} expanded evidence`}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        />
      </div>
    </section>
  );
}
