import { ExtractedFile } from "./project-analyzer";

export function retrieveRelevantFiles(prompt: string, files: ExtractedFile[], limit = 5): ExtractedFile[] {
  const q = prompt.toLowerCase();
  
  // Scoring
  const scored = files.map(f => {
    let score = 0;
    const nameLower = f.name.toLowerCase();
    const pathLower = f.path.toLowerCase();
    
    if (nameLower.includes(q)) score += 100;
    if (pathLower.includes(q)) score += 50;
    
    // Split keywords
    const keywords = q.split(/[\s,.-]+/);
    for (const kw of keywords) {
      if (kw.length < 3) continue;
      if (nameLower.includes(kw)) score += 20;
      if (f.content && f.content.toLowerCase().includes(kw)) score += 1;
    }
    
    return { file: f, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, limit).map(s => s.file);
}
