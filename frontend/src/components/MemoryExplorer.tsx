import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Brain, 
  Sparkles, 
  Trash2, 
  Edit3, 
  Plus, 
  Search, 
  Network, 
  BookOpen, 
  Film, 
  Layers, 
  Loader2, 
  Database,
  Check,
  X
} from 'lucide-react';
import { api } from '../services/api';

interface MemoryItem {
  id: string;
  created_at: string;
  updated_at?: string;
  content: string;
  type?: 'factual' | 'episodic' | 'context' | 'long_term' | 'graph';
  entities?: string[];
  metadata?: Record<string, any>;
}

interface GraphData {
  provider: 'neo4j' | 'postgresql';
  nodes: Array<{ id: string; name: string; label: string }>;
  edges: Array<{ id: string; source: string; target: string; relation: string; weight?: number }>;
}

interface MemoryExplorerProps {
  selectedModel?: string;
  onClose?: () => void;
}

export const MemoryExplorer: React.FC<MemoryExplorerProps> = ({ selectedModel }) => {
  const [activeTab, setActiveTab] = useState<'all' | 'factual' | 'episodic' | 'graph' | 'context'>('all');
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Add memory state
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState<'factual' | 'episodic' | 'context'>('factual');
  const [isAdding, setIsAdding] = useState(false);

  // Edit memory state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  // AI Summarize & Clear All
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  
  // Selected graph node
  const [selectedNode, setSelectedNode] = useState<{ id: string; name: string; label: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load memories
  const loadMemories = async () => {
    setLoading(true);
    try {
      const typeParam = activeTab === 'graph' || activeTab === 'all' ? undefined : activeTab;
      const data = await api.getMemories({
        type: typeParam,
        q: searchQuery.trim() || undefined
      });
      setMemories(data as MemoryItem[]);
    } catch (err) {
      console.error('[Mem0 UI] Failed to load memories:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load graph data
  const loadGraph = async () => {
    setGraphLoading(true);
    try {
      const data = await api.getGraphData();
      setGraphData(data as GraphData);
    } catch (err) {
      console.error('[Mem0 UI] Failed to load graph data:', err);
    } finally {
      setGraphLoading(false);
    }
  };

  useEffect(() => {
    loadMemories();
    if (activeTab === 'graph' || !graphData) {
      loadGraph();
    }
  }, [activeTab, searchQuery]);

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim() || isAdding) return;
    setIsAdding(true);
    try {
      const created = await api.addMemory(newContent.trim(), newType);
      setMemories(prev => [created as MemoryItem, ...prev]);
      setNewContent('');
      loadGraph(); // refresh graph with new entities
    } catch (err) {
      console.error('[Mem0 UI] Add memory error:', err);
    } finally {
      setIsAdding(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingContent.trim()) return;
    try {
      const updated = await api.updateMemory(id, editingContent.trim());
      setMemories(prev => prev.map(m => m.id === id ? ({ ...m, ...updated } as MemoryItem) : m));
      setEditingId(null);
      loadGraph();
    } catch (err) {
      console.error('[Mem0 UI] Update memory error:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteMemory(id);
      setMemories(prev => prev.filter(m => m.id !== id));
      loadGraph();
    } catch (err) {
      console.error('[Mem0 UI] Delete memory error:', err);
    }
  };

  const handleSummarize = async () => {
    setIsSummarizing(true);
    try {
      const res = await api.summarizeMemories(selectedModel);
      setMemories(res.memories as MemoryItem[]);
      loadGraph();
    } catch (err) {
      console.error('[Mem0 UI] Summarize error:', err);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleClearAll = async () => {
    try {
      const typeParam = activeTab === 'all' || activeTab === 'graph' ? undefined : activeTab;
      await api.deleteAllMemories(typeParam);
      setMemories([]);
      setShowClearConfirm(false);
      loadGraph();
    } catch (err) {
      console.error('[Mem0 UI] Clear all error:', err);
    }
  };

  // Filtered memory list
  const displayMemories = useMemo(() => {
    if (activeTab === 'all' || activeTab === 'graph') return memories;
    return memories.filter(m => (m.type || 'factual') === activeTab);
  }, [memories, activeTab]);

  // Knowledge Graph Canvas Renderer
  useEffect(() => {
    if (activeTab !== 'graph' || !graphData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.parentElement?.clientWidth || 550;
    const height = 360;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear background
    ctx.fillStyle = '#0B0F17';
    ctx.fillRect(0, 0, width, height);

    // Draw subtle grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const { nodes, edges } = graphData;
    if (nodes.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No knowledge graph entities extracted yet.', width / 2, height / 2);
      ctx.fillText('Add memories or complete tasks to build the graph.', width / 2, height / 2 + 20);
      return;
    }

    // Position nodes circularly / clustered
    const nodePositions = new Map<string, { x: number; y: number; color: string }>();
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.38;

    const labelColors: Record<string, string> = {
      User: '#8b5cf6',
      Preference: '#6366f1',
      Technology: '#818cf8',
      Service: '#94a3b8',
      Task: '#a5b4fc',
      Lesson: '#64748b',
      Component: '#475569',
      Entity: '#6366f1',
    };

    nodes.forEach((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * 2 * Math.PI - Math.PI / 2;
      const r = radius * (0.65 + (i % 3) * 0.25);
      const x = centerX + r * Math.cos(angle);
      const y = centerY + r * Math.sin(angle);
      const color = labelColors[n.label] || '#6366f1';
      nodePositions.set(n.id, { x, y, color });
    });

    // Draw Edges
    edges.forEach(e => {
      const src = nodePositions.get(e.source);
      const tgt = nodePositions.get(e.target);
      if (!src || !tgt) return;

      // Draw line
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw relation text
      const midX = (src.x + tgt.x) / 2;
      const midY = (src.y + tgt.y) / 2;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(e.relation, midX, midY - 3);
    });

    // Draw Nodes
    nodes.forEach(n => {
      const pos = nodePositions.get(n.id);
      if (!pos) return;

      const isSelected = selectedNode?.id === n.id;

      // Glow effect
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, isSelected ? 18 : 12, 0, 2 * Math.PI);
      ctx.fillStyle = pos.color + (isSelected ? '44' : '22');
      ctx.fill();

      // Node Body
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, isSelected ? 12 : 8, 0, 2 * Math.PI);
      ctx.fillStyle = pos.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Label text
      ctx.fillStyle = '#f1f5f9';
      ctx.font = isSelected ? 'bold 11px Inter, sans-serif' : '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.name, pos.x, pos.y + (isSelected ? 24 : 18));
    });

  }, [activeTab, graphData, selectedNode]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!graphData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = canvas.parentElement?.clientWidth || 550;
    const height = 360;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.38;

    const clicked = graphData.nodes.find((_n, i) => {
      const angle = (i / Math.max(1, graphData.nodes.length)) * 2 * Math.PI - Math.PI / 2;
      const r = radius * (0.65 + (i % 3) * 0.25);
      const nx = centerX + r * Math.cos(angle);
      const ny = centerY + r * Math.sin(angle);
      const dist = Math.hypot(x - nx, y - ny);
      return dist <= 18;
    });

    setSelectedNode(clicked || null);
  };

  const getTypeBadge = (type?: string) => {
    switch (type) {
      case 'episodic':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/[0.06] text-slate-300 border border-white/[0.1]">Episodic</span>;
      case 'context':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/[0.06] text-slate-300 border border-white/[0.1]">Context</span>;
      case 'long_term':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/[0.06] text-slate-300 border border-white/[0.1]">Long-term</span>;
      case 'factual':
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Factual</span>;
    }
  };

  return (
    <div className="space-y-4 text-slate-200">
      {/* Top Banner / Engine Status */}
      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[#111420] border border-white/[0.08] text-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-slate-100 flex items-center gap-2">
              <span>Mem0 Multi-Tier Engine</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-white/[0.06] text-slate-300 border border-white/[0.1]">Active</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Factual, Episodic, Context, & Graph Memory
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <span className="flex items-center gap-1 text-slate-400">
            <Database className="w-3 h-3 text-indigo-400" />
            <span>Store:</span>
            <strong className="text-slate-200 uppercase font-mono">{graphData?.provider || 'PostgreSQL'}</strong>
          </span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-400">
            Nodes: <strong className="text-slate-200">{graphData?.nodes.length || 0}</strong>
          </span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-400">
            Edges: <strong className="text-slate-200">{graphData?.edges.length || 0}</strong>
          </span>
        </div>
      </div>

      {/* Filter Tabs Strip */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2">
        <div className="flex items-center gap-1 overflow-x-auto py-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'all'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>All</span>
            <span className="text-[10px] opacity-75 font-mono">({memories.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('factual')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'factual'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Factual</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('episodic')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'episodic'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Episodic</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('graph')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'graph'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Knowledge Graph</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('context')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'context'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Context</span>
          </button>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleSummarize}
            disabled={isSummarizing || memories.length === 0}
            className="px-2.5 py-1.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-300 text-xs font-medium transition-all flex items-center gap-1 disabled:opacity-40"
            title="Consolidate duplicate memories using AI"
          >
            {isSummarizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            <span>AI Summarize</span>
          </button>

          {memories.length > 0 && (
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 text-xs font-medium transition-all flex items-center gap-1"
              title="Clear stored memories"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Bar & Manual Add Form (When not on Graph View) */}
      {activeTab !== 'graph' && (
        <div className="space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search memories, preferences, tasks, or extracted entities..."
              className="w-full bg-[#0E121D] border border-white/[0.08] rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Add New Memory Form */}
          <form onSubmit={handleAddMemory} className="flex gap-2">
            <div className="flex-1 flex gap-2 bg-[#0E121D] border border-white/[0.08] rounded-xl px-3 py-1.5 focus-within:border-indigo-500">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as any)}
                className="bg-transparent text-indigo-400 font-semibold text-xs border-r border-white/[0.08] pr-2 focus:outline-none cursor-pointer"
              >
                <option value="factual" className="bg-[#121622] text-slate-200">Factual</option>
                <option value="episodic" className="bg-[#121622] text-slate-200">Episodic</option>
                <option value="context" className="bg-[#121622] text-slate-200">Context</option>
              </select>
              <input
                type="text"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="e.g. User prefers TypeScript and TailwindCSS..."
                className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={!newContent.trim() || isAdding}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-xs rounded-xl transition-all flex items-center gap-1 cursor-pointer shrink-0"
            >
              {isAdding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>Add</span>
            </button>
          </form>
        </div>
      )}

      {/* View: Knowledge Graph Explorer */}
      {activeTab === 'graph' ? (
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden border border-white/[0.08] bg-[#0B0F17]">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="w-full cursor-pointer"
            />
            {graphLoading && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
              </div>
            )}
          </div>

          {/* Node detail drawer */}
          {selectedNode ? (
            <div className="p-3 rounded-xl bg-[#131724] border border-indigo-500/30 flex items-center justify-between text-xs">
              <div>
                <span className="text-[10px] uppercase font-mono text-indigo-400 tracking-wider block">
                  Selected Entity ({selectedNode.label})
                </span>
                <strong className="text-sm text-white">{selectedNode.name}</strong>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 text-center">
              Click any entity node on the canvas to inspect its relationships.
            </p>
          )}
        </div>
      ) : (
        /* View: Memory Items List */
        <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
            </div>
          ) : displayMemories.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-500">
              No memories found for current filter.
            </div>
          ) : (
            displayMemories.map((m) => {
              const isEditing = editingId === m.id;
              return (
                <div
                  key={m.id}
                  className="p-3 rounded-xl bg-[#131724] border border-white/[0.06] hover:border-white/[0.12] transition-all space-y-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {getTypeBadge(m.type)}
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(m.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    {!isEditing && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setEditingId(m.id); setEditingContent(m.content); }}
                          className="p-1 text-slate-500 hover:text-white rounded hover:bg-white/[0.06]"
                          title="Edit memory"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(m.id)}
                          className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-rose-500/10"
                          title="Delete memory"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        className="w-full bg-[#0C0F18] text-white text-xs p-2 rounded-lg border border-white/[0.1] focus:outline-none"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(m.id)}
                          className="px-2.5 py-1 rounded bg-indigo-600 text-white font-semibold text-[11px] flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" />
                          <span>Save</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 rounded bg-white/[0.05] text-slate-400 text-[11px]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-slate-200 leading-relaxed select-text whitespace-pre-wrap">{m.content}</p>
                      {m.entities && m.entities.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {m.entities.map((ent, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-950/60 text-indigo-300 border border-indigo-500/20"
                            >
                              #{ent}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm bg-[#121622] border border-rose-500/30 rounded-2xl p-5 shadow-2xl space-y-3">
            <h4 className="font-bold text-sm text-rose-400 flex items-center gap-2">
              <Trash2 className="w-4 h-4" />
              <span>Clear Stored Memories?</span>
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              This will permanently delete all {displayMemories.length} stored {activeTab === 'all' ? '' : activeTab} memories and reset the knowledge graph.
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer"
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
