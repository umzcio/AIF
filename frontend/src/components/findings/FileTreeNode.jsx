import { useState } from "react";
import { FileCode, Folder, FolderOpen } from "lucide-react";
import { C, TRACK_COLORS } from "../../constants.js";
import { SEV } from "./utils.js";

// A11Y-04: ARIA APG Tree View pattern. Roving tabindex is coordinated from the
// `role="tree"` container in FindingsReview.jsx via `activePath`/`onFocusNode` —
// only the node whose fullPath matches `activePath` is Tab-reachable (tabIndex 0),
// every other node is -1. Arrow-key/Home/End navigation across visible nodes and
// expand/collapse are handled by the container's onKeyDown (DOM traversal over
// `[role="treeitem"]`, in visible DOM order) since collapsed subtrees don't
// exist in the DOM. See FindingsReview.jsx `handleTreeKeyDown` for the pattern.
export default function FileTreeNode({ node, depth = 0, onSelect, selectedFile, path = "", activePath = null, onFocusNode }) {
  const [open, setOpen] = useState(depth < 2);
  const isDir = node.type === "dir";
  const hasFindings = !isDir && node.findings > 0;
  const fullPath = path ? `${path}/${node.name}` : node.name;
  const isSelected = !isDir && selectedFile === fullPath;
  const isActive = fullPath === activePath;
  const handleClick = () => isDir ? setOpen(!open) : onSelect?.(fullPath);
  const handleKeyDown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } };
  return (
    <div>
      <div role="treeitem" tabIndex={isActive ? 0 : -1} data-path={fullPath} onClick={handleClick} onKeyDown={handleKeyDown}
        onFocus={() => onFocusNode?.(fullPath)}
        aria-expanded={isDir ? open : undefined}
        aria-current={isSelected ? "true" : undefined}
        aria-label={`${isDir ? (open ? "Collapse" : "Expand") + " folder" : "File"} ${node.name}${hasFindings ? `, ${node.findings} findings` : ""}`}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", paddingLeft: 8 + depth * 16,
          borderRadius: 4, cursor: "pointer", fontSize: 12, color: hasFindings ? C.text : C.textMid,
          fontFamily: "'JetBrains Mono', monospace", fontWeight: hasFindings ? 600 : 400,
          background: isSelected ? C.accentSoft : "transparent", transition: "background .1s",
          overflow: "hidden", whiteSpace: "nowrap" }}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.surfaceHover; }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
        {isDir ? (open ? <FolderOpen size={13} color={C.accent} style={{ flexShrink: 0 }} /> : <Folder size={13} color={C.textDim} style={{ flexShrink: 0 }} />) : <FileCode size={13} color={hasFindings ? TRACK_COLORS[3] : C.textDim} style={{ flexShrink: 0 }} />}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>
        {hasFindings && <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: SEV.high.bg, color: SEV.high.color, fontWeight: 700, flexShrink: 0 }}>{node.findings}</span>}
      </div>
      {isDir && open && <div role="group">{node.children?.map((child, i) => (
        <FileTreeNode key={i} node={child} depth={depth + 1} onSelect={onSelect} selectedFile={selectedFile}
          path={isDir ? fullPath.replace(/\/$/, "") : fullPath} activePath={activePath} onFocusNode={onFocusNode} />
      ))}</div>}
    </div>
  );
}
