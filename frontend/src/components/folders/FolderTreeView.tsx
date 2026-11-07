/**
 * FolderTreeView - Arborescence de dossiers pour sidebar (style Dropbox)
 *
 * Affiche une vue hiérarchique de tous les dossiers avec:
 * - Expand/collapse des sous-dossiers
 * - Navigation au clic
 * - Highlight du dossier actif
 * - Icônes et couleurs
 */

import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Folder as FolderIcon } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Folder } from '../../types/folder';
import { getRootFolders, getSubFolders } from '../../mocks/folders';
import { FOLDER_COLORS } from '../../types/folder';

interface FolderNode extends Folder {
  children: FolderNode[];
  expanded: boolean;
}

/**
 * Vérifie si un nœud contient un dossier donné (lui-même ou descendant)
 */
const containsFolder = (node: FolderNode, targetId: string): boolean => {
  if (node.id === targetId) {
    return true;
  }

  return node.children.some(child => containsFolder(child, targetId));
};

/**
 * Expand récursivement le chemin vers un dossier donné
 */
const expandPathToFolder = (nodes: FolderNode[], targetId: string): FolderNode[] => {
  return nodes.map(node => {
    const hasTarget = containsFolder(node, targetId);

    if (hasTarget) {
      return {
        ...node,
        expanded: true,
        children: expandPathToFolder(node.children, targetId)
      };
    }

    return node;
  });
};

export const FolderTreeView: React.FC = () => {
  const [tree, setTree] = useState<FolderNode[]>([]);
  const { folderId } = useParams<{ folderId?: string }>();
  const navigate = useNavigate();

  // Construire l'arbre initial
  useEffect(() => {
    const buildTree = (): FolderNode[] => {
      const rootFolders = getRootFolders();
      return rootFolders.map(folder => ({
        ...folder,
        children: buildSubTree(folder.id),
        expanded: false // Par défaut fermé
      }));
    };

    const buildSubTree = (parentId: string): FolderNode[] => {
      const subFolders = getSubFolders(parentId);
      return subFolders.map(folder => ({
        ...folder,
        children: buildSubTree(folder.id),
        expanded: false
      }));
    };

    setTree(buildTree());
  }, []);

  // Auto-expand le chemin vers le dossier actif
  useEffect(() => {
    if (folderId) {
      setTree(prevTree => expandPathToFolder(prevTree, folderId));
    }
  }, [folderId]);

  /**
   * Toggle l'état expanded d'un dossier
   */
  const toggleFolder = (folderId: string) => {
    const updateExpanded = (nodes: FolderNode[]): FolderNode[] => {
      return nodes.map(node => {
        if (node.id === folderId) {
          return { ...node, expanded: !node.expanded };
        }

        if (node.children.length > 0) {
          return { ...node, children: updateExpanded(node.children) };
        }

        return node;
      });
    };

    setTree(prevTree => updateExpanded(prevTree));
  };

  /**
   * Navigate vers un dossier
   */
  const handleNavigate = (folderId: string) => {
    navigate(`/folder/${folderId}`);
  };

  return (
    <div className="w-64 bg-white border-r border-gray-200 h-full overflow-y-auto flex-shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
          Folders
        </h2>
      </div>

      {/* Tree */}
      <div className="p-2">
        {tree.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            <FolderIcon className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p>No folders yet</p>
          </div>
        ) : (
          tree.map(node => (
            <FolderTreeNode
              key={node.id}
              node={node}
              level={0}
              activeFolderId={folderId}
              onToggle={toggleFolder}
              onNavigate={handleNavigate}
            />
          ))
        )}
      </div>
    </div>
  );
};

interface FolderTreeNodeProps {
  node: FolderNode;
  level: number;
  activeFolderId?: string;
  onToggle: (folderId: string) => void;
  onNavigate: (folderId: string) => void;
}

const FolderTreeNode: React.FC<FolderTreeNodeProps> = ({
  node,
  level,
  activeFolderId,
  onToggle,
  onNavigate
}) => {
  const hasChildren = node.children.length > 0;
  const isActive = node.id === activeFolderId;
  const colorConfig = FOLDER_COLORS[node.color as keyof typeof FOLDER_COLORS] || FOLDER_COLORS.blue;

  return (
    <div>
      {/* Node principal */}
      <div
        className={`
          flex items-center gap-1 py-1.5 px-2 rounded-lg
          cursor-pointer transition-all group
          ${isActive
            ? 'bg-primary-50 text-primary-700'
            : 'hover:bg-gray-50 text-gray-700'
          }
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {/* Expand/Collapse Button */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className={`
              p-0.5 rounded transition-colors flex-shrink-0
              ${isActive
                ? 'hover:bg-primary-100'
                : 'hover:bg-gray-200'
              }
            `}
            title={node.expanded ? 'Collapse' : 'Expand'}
          >
            {node.expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <div className="w-5" /> // Spacer pour alignement
        )}

        {/* Folder Icon */}
        <div
          className={`
            w-5 h-5 rounded flex items-center justify-center flex-shrink-0
            ${isActive ? colorConfig.bg : 'group-hover:bg-gray-100'}
          `}
        >
          <FolderIcon
            className={`h-3.5 w-3.5 ${isActive ? colorConfig.text : 'text-gray-500'}`}
          />
        </div>

        {/* Folder Name */}
        <span
          onClick={() => onNavigate(node.id)}
          className={`
            text-sm flex-1 truncate
            ${isActive ? 'font-semibold' : 'font-medium group-hover:text-gray-900'}
          `}
          title={node.name}
        >
          {node.name}
        </span>

        {/* File Count Badge */}
        {node.fileCount > 0 && (
          <span
            className={`
              text-xs px-1.5 py-0.5 rounded-full flex-shrink-0
              ${isActive
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 group-hover:bg-gray-200'
              }
            `}
          >
            {node.fileCount}
          </span>
        )}
      </div>

      {/* Children (si expanded) */}
      {node.expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <FolderTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              activeFolderId={activeFolderId}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
};
