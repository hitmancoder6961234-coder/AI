// knowledge-engine.ts
import { ExtractedFile, ProjectAnalysis } from "./project-analyzer.js";
import {
  createKnowledgeChunksBatch,
  listKnowledgeChunks,
  deleteKnowledgeForProject,
  getProject,
  listFiles,
  getProjectAnalysis,
} from "./db.js";

export interface KnowledgeChunk {
  id: string;
  projectId: string;
  fileId: string;
  relativePath: string;
  language: string;
  symbol?: string;
  startLine: number;
  endLine: number;
  chunkType: string;
  hash: string;
  content: string;
}

export interface FileKnowledge {
  fileId: string;
  path: string;
  filename: string;
  extension: string;
  type: string;
  size: number;
  hash: string;
  summary?: string;
  chunks: KnowledgeChunk[];
}

export interface ProjectKnowledge {
  projectId: string;
  name: string;
  type: string;
  languages: string[];
  frameworks: string[];
  files: Map<string, FileKnowledge>;
  architecture?: any;
  diagnostics?: any;
  tests?: any;
  docs?: any;
  summary?: any;
  indexingState: 'Not Indexed' | 'Indexing' | 'Indexed' | 'Partially Indexed' | 'Stale' | 'Failed';
}

const knowledgeStore = new Map<string, ProjectKnowledge>();

export function getProjectKnowledge(projectId: string): ProjectKnowledge | undefined {
  if (knowledgeStore.has(projectId)) {
    return knowledgeStore.get(projectId);
  }

  // Load from persistent SQLite database
  const proj = getProject(projectId);
  if (!proj) return undefined;

  const dbChunks = listKnowledgeChunks(projectId);
  const dbFiles = listFiles(projectId);
  const analysis = getProjectAnalysis(projectId);

  const fileMap = new Map<string, FileKnowledge>();

  // Group chunks by file_id
  const chunksByFile = new Map<string, KnowledgeChunk[]>();
  for (const c of dbChunks) {
    const kc: KnowledgeChunk = {
      id: c.id,
      projectId: c.project_id,
      fileId: c.file_id,
      relativePath: c.file_id,
      language: c.chunk_type === 'code' ? 'code' : 'text',
      symbol: c.symbol,
      startLine: c.start_line,
      endLine: c.end_line,
      chunkType: c.chunk_type,
      hash: c.hash,
      content: c.content,
    };
    if (!chunksByFile.has(c.file_id)) {
      chunksByFile.set(c.file_id, []);
    }
    chunksByFile.get(c.file_id)!.push(kc);
  }

  for (const f of dbFiles) {
    if (f.is_binary) continue;
    const chunks = chunksByFile.get(f.path) || [];
    fileMap.set(f.path, {
      fileId: f.path,
      path: f.path,
      filename: f.name,
      extension: f.extension,
      type: f.is_binary ? 'binary' : 'text',
      size: f.size,
      hash: f.hash,
      chunks,
    });
  }

  const pk: ProjectKnowledge = {
    projectId,
    name: proj.name,
    type: analysis?.projectType || proj.source_type || 'unknown',
    languages: analysis?.languages?.map((l: any) => l.name) || [],
    frameworks: analysis?.frameworks || [],
    files: fileMap,
    architecture: analysis?.architecture,
    diagnostics: analysis?.architecture?.health,
    indexingState: dbChunks.length > 0 ? 'Indexed' : 'Not Indexed',
  };

  knowledgeStore.set(projectId, pk);
  return pk;
}

import crypto from 'crypto';

export function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function chunkFileContent(file: ExtractedFile, projectId: string): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const lines = file.content.split('\n');
  const fileHash = computeHash(file.content);
  
  if (file.isBinary) return chunks;

  if (file.extension.toLowerCase() === '.ipynb') {
    try {
      const nb = JSON.parse(file.content);
      const cells = nb.cells || [];
      let cellLines = [];
      let cellIdx = 1;
      for (const cell of cells) {
        if (!cell.source) continue;
        const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
        chunks.push({
          id: `${projectId}_${file.path}_cell${cellIdx}`,
          projectId,
          fileId: file.path,
          relativePath: file.path,
          language: cell.cell_type === 'code' ? 'python' : 'markdown',
          symbol: `Cell ${cellIdx} (${cell.cell_type})`,
          startLine: cellIdx,
          endLine: cellIdx,
          content: source,
          chunkType: cell.cell_type === 'code' ? 'function' : 'text', // was `type`: the schema field is chunkType, so notebook chunks had none
          hash: computeHash(source)
        });
        cellIdx++;
      }
      return chunks;
    } catch (err) {
      // fallback to text chunking if JSON parse fails
    }
  }


  // Simple structure-aware chunking based on indentation or keywords
  // We'll group lines into chunks. This is a very naive but fast approach.
  let currentChunkLines: string[] = [];
  let startLine = 1;
  let currentSymbol = '';
  let currentType = 'text';

  const ext = file.extension.toLowerCase();
  const isCode = ['.ts', '.js', '.py', '.java', '.go', '.c', '.cpp', '.cs', '.php', '.rs'].includes(ext);

  if (isCode) {
    let braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentChunkLines.push(line);
      
      // Basic detection
      if (line.match(/(class|function|const|let|var)\s+([a-zA-Z0-9_]+)/)) {
        if (braceDepth === 0) {
          const match = line.match(/(class|function|const|let|var)\s+([a-zA-Z0-9_]+)/);
          if (match && !currentSymbol) {
            currentSymbol = match[2];
            currentType = match[1] === 'class' ? 'class' : 'function';
          }
        }
      }

      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      // Split if we're at root depth and chunk is getting big, or if it's a natural break (like an empty line at root)
      if ((braceDepth <= 0 && currentChunkLines.length > 10 && line.trim() === '') || currentChunkLines.length > 100) {
        chunks.push({
          id: `chunk_${projectId}_${file.path}_${startLine}`,
          projectId,
          fileId: file.path,
          relativePath: file.path,
          language: ext.substring(1),
          symbol: currentSymbol || 'unknown',
          startLine,
          endLine: i + 1,
          chunkType: currentType,
          hash: computeHash(currentChunkLines.join('\n')),
          content: currentChunkLines.join('\n')
        });
        currentChunkLines = [];
        startLine = i + 2;
        currentSymbol = '';
        currentType = 'code';
        braceDepth = Math.max(0, braceDepth); // reset if it went negative
      }
    }
  } else {
    // For markdown/text, chunk by paragraphs or sections
    for (let i = 0; i < lines.length; i++) {
      currentChunkLines.push(lines[i]);
      if ((lines[i].trim() === '' && currentChunkLines.length > 10) || currentChunkLines.length > 50) {
        chunks.push({
          id: `chunk_${projectId}_${file.path}_${startLine}`,
          projectId,
          fileId: file.path,
          relativePath: file.path,
          language: ext.substring(1),
          startLine,
          endLine: i + 1,
          chunkType: 'text',
          hash: computeHash(currentChunkLines.join('\n')),
          content: currentChunkLines.join('\n')
        });
        currentChunkLines = [];
        startLine = i + 2;
      }
    }
  }

  if (currentChunkLines.length > 0) {
    chunks.push({
      id: `chunk_${projectId}_${file.path}_${startLine}`,
      projectId,
      fileId: file.path,
      relativePath: file.path,
      language: ext.substring(1),
      symbol: currentSymbol || 'unknown',
      startLine,
      endLine: lines.length,
      chunkType: currentType,
      hash: computeHash(currentChunkLines.join('\n')),
      content: currentChunkLines.join('\n')
    });
  }

  return chunks;
}

export function indexProject(projectId: string, projName: string, files: ExtractedFile[], analysis: ProjectAnalysis): ProjectKnowledge {
  const fileMap = new Map<string, FileKnowledge>();
  
  for (const f of files) {
    if (f.isBinary) continue;
    const hash = computeHash(f.content);
    const chunks = chunkFileContent(f, projectId);
    fileMap.set(f.path, {
      fileId: f.path,
      path: f.path,
      filename: f.name,
      extension: f.extension,
      type: f.isBinary ? 'binary' : 'text',
      size: f.size,
      hash,
      chunks
    });
  }

  const pk: ProjectKnowledge = {
    projectId,
    name: projName,
    type: analysis?.projectType || 'unknown',
    languages: [], // Extract from files if needed
    frameworks: [],
    files: fileMap,
    architecture: analysis?.architecture,
    diagnostics: analysis?.architecture?.health,
    indexingState: 'Indexed'
  };

  // Persist all generated chunks to SQLite in a single transaction
  const allChunksToPersist: Array<{
    id: string;
    project_id: string;
    file_id: string;
    chunk_id: string;
    content: string;
    chunk_type?: string;
    symbol?: string;
    start_line?: number;
    end_line?: number;
    hash?: string;
    version?: number;
  }> = [];

  for (const [filePath, fk] of fileMap.entries()) {
    for (const chunk of fk.chunks) {
      allChunksToPersist.push({
        id: chunk.id,
        project_id: projectId,
        file_id: filePath,
        chunk_id: chunk.id,
        content: chunk.content,
        chunk_type: chunk.chunkType,
        symbol: chunk.symbol,
        start_line: chunk.startLine,
        end_line: chunk.endLine,
        hash: chunk.hash,
        version: 1,
      });
    }
  }

  try {
    createKnowledgeChunksBatch(allChunksToPersist);
  } catch (err) {
    console.warn("Failed to batch persist chunks to SQLite:", err);
  }

  knowledgeStore.set(projectId, pk);
  return pk;
}

export function updateFileKnowledge(projectId: string, file: ExtractedFile) {
  const pk = knowledgeStore.get(projectId);
  if (!pk) return;

  const newHash = computeHash(file.content);
  const existing = pk.files.get(file.path);
  
  if (existing && existing.hash === newHash) {
    return; // Unchanged
  }

  const chunks = chunkFileContent(file, projectId);
  pk.files.set(file.path, {
    fileId: file.path,
    path: file.path,
    filename: file.name,
    extension: file.extension,
    type: file.isBinary ? 'binary' : 'text',
    size: file.size,
    hash: newHash,
    chunks
  });
}

export function deleteFileKnowledge(projectId: string, path: string) {
  const pk = knowledgeStore.get(projectId);
  if (pk) {
    pk.files.delete(path);
  }
}

export interface SearchResult {
  chunk: KnowledgeChunk;
  score: number;
  reason: string;
}

export function detectIntent(query: string): string {
  const q = query.toLowerCase();
  if (q.includes('why') || q.includes('error') || q.includes('fail') || q.includes('debug')) return 'DEBUG';
  if (q.includes('how does') || q.includes('explain') || q.includes('what happens')) return 'EXPLAIN';
  if (q.includes('where is') || q.includes('find') || q.includes('which file')) return 'SEARCH';
  if (q.includes('architecture') || q.includes('connect') || q.includes('flow')) return 'ARCHITECTURE';
  return 'GENERAL';
}

export function searchKnowledge(projectId: string, query: string, limit: number = 10): SearchResult[] {
  const pk = getProjectKnowledge(projectId);
  if (!pk) return [];

  const intent = detectIntent(query);
  const qLower = query.toLowerCase();
  const keywords = qLower.split(/[\s,.-_?]+/).filter(k => k.length > 2);
  
  const results: SearchResult[] = [];

  for (const [path, file] of pk.files.entries()) {
    const pathLower = path.toLowerCase();
    const isPathMatch = keywords.some(k => pathLower.includes(k));
    
    for (const chunk of file.chunks) {
      let score = 0;
      let reasons: string[] = [];

      // 1. Path Match
      if (isPathMatch) {
        score += 10;
        reasons.push('Path match');
      }

      const contentLower = chunk.content.toLowerCase();
      
      // 2. Exact Phrase Match
      if (contentLower.includes(qLower)) {
        score += 50;
        reasons.push('Exact phrase match');
      }

      // 3. Keyword Match (TF-IDF approximation)
      let kwMatches = 0;
      for (const kw of keywords) {
        if (contentLower.includes(kw)) {
          kwMatches++;
          score += 2;
        }
      }
      if (kwMatches > 0) {
        reasons.push(`Matched ${kwMatches} keywords`);
      }

      // 4. Symbol Match
      if (chunk.symbol && chunk.symbol !== 'unknown') {
        const symbolLower = chunk.symbol.toLowerCase();
        if (keywords.some(k => symbolLower.includes(k))) {
          score += 20;
          reasons.push('Symbol match');
        }
      }

      // 5. Intent based boosting
      if (intent === 'DEBUG' && contentLower.includes('error')) score += 5;
      if (intent === 'ARCHITECTURE' && (contentLower.includes('import') || contentLower.includes('export') || contentLower.includes('api'))) score += 5;
      
      if (score > 0) {
        results.push({
          chunk,
          score,
          reason: reasons.join(', ')
        });
      }
    }
  }

  // Sort by score
  results.sort((a, b) => b.score - a.score);
  
  // Deduplicate chunks (ensure diversity)
  const uniqueResults: SearchResult[] = [];
  const seenPaths = new Set<string>();
  
  for (const r of results) {
    if (uniqueResults.length >= limit) break;
    // We allow up to 3 chunks per file to ensure we get a diverse set of files
    const pathCount = Array.from(seenPaths).filter(p => p === r.chunk.relativePath).length;
    if (pathCount < 3) {
      uniqueResults.push(r);
      seenPaths.add(r.chunk.relativePath);
    }
  }

  return uniqueResults;
}

export function assembleContext(results: SearchResult[], architecture?: any): string {
  let context = "=== RELEVANT PROJECT EVIDENCE ===\n\n";
  
  for (const res of results) {
    context += `File: ${res.chunk.relativePath} (Lines ${res.chunk.startLine}-${res.chunk.endLine})\n`;
    context += `Relevance: ${res.reason} (Score: ${res.score})\n`;
    context += `\`\`\`${res.chunk.language}\n`;
    context += res.chunk.content + "\n";
    context += `\`\`\`\n\n`;
  }

  if (architecture && architecture.summary) {
    context += `\n=== PROJECT ARCHITECTURE SUMMARY ===\n`;
    context += `${architecture.summary}\n`;
  }
  
  return context;
}

export function deleteProjectKnowledge(projectId: string) {
  knowledgeStore.delete(projectId);
  try {
    deleteKnowledgeForProject(projectId);
  } catch (err) {
    console.warn(`Failed to delete SQLite knowledge chunks for ${projectId}:`, err);
  }
}
