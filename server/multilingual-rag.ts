// multilingual-rag.ts
// Robust General Multilingual Query Processing, Entity Preservation, Language Detection,
// Query Normalization, Intent Classification, Cross-Language Search Expansion, and Grounding.

export interface DetectedLanguage {
  code: string;            // 'en', 'hi', 'hinglish', 'mr', 'roman_mr', 'gu', 'bn', 'ta', 'te', 'kn', 'ml', 'pa', 'ur', 'mixed'
  displayName: string;     // 'English', 'Hinglish', 'Hindi', 'Marathi', etc.
  isHinglish: boolean;
  isDevanagari: boolean;
  isRomanizedRegional: boolean;
  script: string;
}

export interface ExtractedEntity {
  type: "structural" | "domain" | "date" | "time" | "room" | "numeric" | "code";
  raw: string;
  normalized: string;
  variants: string[];
}

export interface ParsedMultilingualQuery {
  rawQuery: string;
  detectedLang: DetectedLanguage;
  intent: "SYLLABUS_CONTENT" | "SCHEDULE_EXAM" | "LOCATION_VENUE" | "NUMERIC_FEE" | "FACULTY_PERSON" | "GENERAL_EXPLAIN";
  entities: ExtractedEntity[];
  structuralEntities: string[]; // e.g. ["Module 4", "Chapter 7"]
  cleanKeywords: string[];     // keywords with language question stop-words removed
  expandedSearchVariants: string[]; // internal search strings
  isFollowUp: boolean;
  resolvedContextQuery: string;
}

// -------------------------------------------------------------------------
// 1. LANGUAGE DETECTION
// -------------------------------------------------------------------------

export function detectQueryLanguage(text: string): DetectedLanguage {
  const raw = (text || "").trim();
  if (!raw) {
    return {
      code: "en",
      displayName: "English",
      isHinglish: false,
      isDevanagari: false,
      isRomanizedRegional: false,
      script: "latin",
    };
  }

  // Unicode range checks
  const hasDevanagari = /[\u0900-\u097F]/.test(raw);
  const hasGujarati = /[\u0A80-\u0AFF]/.test(raw);
  const hasBengali = /[\u0980-\u09FF]/.test(raw);
  const hasTamil = /[\u0B80-\u0BFF]/.test(raw);
  const hasTelugu = /[\u0C00-\u0C7F]/.test(raw);
  const hasKannada = /[\u0C80-\u0C8F]/.test(raw);
  const hasMalayalam = /[\u0D00-\u0D7F]/.test(raw);
  const hasGurmukhi = /[\u0A00-\u0A7F]/.test(raw);
  const hasArabicUrdu = /[\u0600-\u06FF]/.test(raw);

  if (hasGujarati) return { code: "gu", displayName: "Gujarati", isHinglish: false, isDevanagari: false, isRomanizedRegional: false, script: "gujarati" };
  if (hasBengali) return { code: "bn", displayName: "Bengali", isHinglish: false, isDevanagari: false, isRomanizedRegional: false, script: "bengali" };
  if (hasTamil) return { code: "ta", displayName: "Tamil", isHinglish: false, isDevanagari: false, isRomanizedRegional: false, script: "tamil" };
  if (hasTelugu) return { code: "te", displayName: "Telugu", isHinglish: false, isDevanagari: false, isRomanizedRegional: false, script: "telugu" };
  if (hasKannada) return { code: "kn", displayName: "Kannada", isHinglish: false, isDevanagari: false, isRomanizedRegional: false, script: "kannada" };
  if (hasMalayalam) return { code: "ml", displayName: "Malayalam", isHinglish: false, isDevanagari: false, isRomanizedRegional: false, script: "malayalam" };
  if (hasGurmukhi) return { code: "pa", displayName: "Punjabi", isHinglish: false, isDevanagari: false, isRomanizedRegional: false, script: "gurmukhi" };
  if (hasArabicUrdu) return { code: "ur", displayName: "Urdu", isHinglish: false, isDevanagari: false, isRomanizedRegional: false, script: "arabic" };

  if (hasDevanagari) {
    const marathiMarkers = ["मध्ये", "आहे", "विषय", "सांगा", "कोणते", "बद्दल", "काय"];
    const lower = raw.toLowerCase();
    const isMarathi = marathiMarkers.some(m => lower.includes(m));
    return {
      code: isMarathi ? "mr" : "hi",
      displayName: isMarathi ? "Marathi" : "Hindi",
      isHinglish: false,
      isDevanagari: true,
      isRomanizedRegional: false,
      script: "devanagari",
    };
  }

  // Check Romanized / Latin Script
  const lower = raw.toLowerCase();
  const tokens = lower.split(/[\s,.;:!?`"'()\[\]{}]+/).filter(Boolean);

  const hinglishMarkers = [
    "kya", "hai", "he", "mein", "me", "ka", "ke", "ki", "kaa", "kee", "batao",
    "bata", "do", "samjhao", "samjhaao", "padhna", "padhnai", "karo", "karna",
    "chahiye", "kab", "kahan", "kidhar", "kitna", "kitne", "kitni", "kaun",
    "kaise", "matlab", "iske", "isko", "isme", "ismein", "aayega", "aate",
    "hain", "shamil", "antargat", "konsa", "kaunsa", "silabus", "bataiyega"
  ];

  const marathiRomanMarkers = [
    "madhe", "kay", "aahe", "ahe", "che", "sang", "sanga", "baddal", "konta", "konti", "konte"
  ];

  let hinglishMatches = 0;
  let marathiRomanMatches = 0;

  for (const t of tokens) {
    if (hinglishMarkers.includes(t)) hinglishMatches++;
    if (marathiRomanMarkers.includes(t)) marathiRomanMatches++;
  }

  if (marathiRomanMatches >= 1) {
    return {
      code: "roman_mr",
      displayName: "Romanized Marathi",
      isHinglish: true,
      isDevanagari: false,
      isRomanizedRegional: true,
      script: "latin",
    };
  }

  if (hinglishMatches >= 1) {
    return {
      code: "hinglish",
      displayName: "Hinglish (Hindi/English)",
      isHinglish: true,
      isDevanagari: false,
      isRomanizedRegional: true,
      script: "latin",
    };
  }

  return {
    code: "en",
    displayName: "English",
    isHinglish: false,
    isDevanagari: false,
    isRomanizedRegional: false,
    script: "latin",
  };
}

// -------------------------------------------------------------------------
// 2. ROMAN NUMERAL & STRUCTURAL ENTITY HELPER
// -------------------------------------------------------------------------

const ROMAN_NUMERAL_MAP: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20
};

export function normalizeStructuralEntityName(rawEntity: string): { canonical: string; variants: string[] } {
  const clean = rawEntity.trim();
  const lower = clean.toLowerCase();
  const variants = new Set<string>([clean, lower, clean.toUpperCase()]);

  // Match pattern like "Module 4", "Module IV", "Chapter 7", "Unit 2", "Section B"
  const m = lower.match(/^(module|mod|chapter|chap|unit|section|part|lesson|page|table|schedule|topic)\s*([a-z0-9ivxlcdm]+)$/i);
  if (m) {
    let normPrefix = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    if (normPrefix === "Mod") normPrefix = "Module";
    if (normPrefix === "Chap") normPrefix = "Chapter";
    const val = m[2];

    let numVal: number | null = null;
    if (/^\d+$/.test(val)) {
      numVal = parseInt(val, 10);
    } else if (ROMAN_NUMERAL_MAP[val.toLowerCase()]) {
      numVal = ROMAN_NUMERAL_MAP[val.toLowerCase()];
    }

    if (numVal !== null) {
      const canonical = `${normPrefix} ${numVal}`;
      const romanStr = Object.keys(ROMAN_NUMERAL_MAP).find(k => ROMAN_NUMERAL_MAP[k] === numVal)?.toUpperCase();
      
      variants.add(canonical);
      variants.add(`${normPrefix.toUpperCase()} ${numVal}`);
      variants.add(`${normPrefix.toLowerCase()} ${numVal}`);
      variants.add(`${normPrefix}-${numVal}`);
      variants.add(`${normPrefix}${numVal}`);
      variants.add(`Module ${numVal}`);
      variants.add(`Unit ${numVal}`);
      variants.add(`Chapter ${numVal}`);
      variants.add(`Mod ${numVal}`);
      if (numVal < 10) {
        variants.add(`${normPrefix} 0${numVal}`);
        variants.add(`Module 0${numVal}`);
        variants.add(`Unit 0${numVal}`);
      }

      if (romanStr) {
        variants.add(`${normPrefix} ${romanStr}`);
        variants.add(`Module ${romanStr}`);
        variants.add(`Unit ${romanStr}`);
        variants.add(`Chapter ${romanStr}`);
      }

      return { canonical, variants: Array.from(variants) };
    }
  }

  return { canonical: clean, variants: Array.from(variants) };
}

// -------------------------------------------------------------------------
// 3. MULTILINGUAL QUERY NORMALIZATION & PARSING
// -------------------------------------------------------------------------

export function parseAndNormalizeMultilingualQuery(
  rawQuery: string,
  conversationHistory?: Array<{ role: string; content: string }>
): ParsedMultilingualQuery {
  const qTrim = (rawQuery || "").trim();
  const detectedLang = detectQueryLanguage(qTrim);

  // 1. Check for follow-up conversation context
  let activeQuery = qTrim;
  let isFollowUp = false;
  const qLower = qTrim.toLowerCase();

  const followUpTokens = [
    "iske", "is me", "isme", "ismein", "is", "it", "they", "this", "that", "these", "those",
    "aur", "also", "important", "syllabus", "explain", "details", "topics", "che", "madhe"
  ];

  const hasFollowUpMarker = followUpTokens.some(tok => qLower.startsWith(tok) || qLower.includes(` ${tok} `) || qLower.includes(`${tok} `));
  const isShortQuery = qTrim.split(/\s+/).length <= 4;

  if ((hasFollowUpMarker || isShortQuery) && conversationHistory && conversationHistory.length > 0) {
    const userHistory = conversationHistory.filter(m => m.role === "user").slice(-2);
    for (const msg of userHistory) {
      if (msg.content) {
        // Look for structural entities in previous turn
        const structMatch = msg.content.match(/\b(?:module|mod|chapter|chap|unit|section|part|lesson)\s*(?:\d+|[ivxlcdm]+)\b/gi);
        if (structMatch && structMatch.length > 0) {
          isFollowUp = true;
          activeQuery = `${structMatch[0]} ${qTrim}`;
          break;
        }
      }
    }
  }

  // Devanagari digit mapping
  let devanagariNormalized = activeQuery
    .replace(/[०]/g, "0")
    .replace(/[१]/g, "1")
    .replace(/[२]/g, "2")
    .replace(/[३]/g, "3")
    .replace(/[४]/g, "4")
    .replace(/[५]/g, "5")
    .replace(/[६]/g, "6")
    .replace(/[७]/g, "7")
    .replace(/[८]/g, "8")
    .replace(/[९]/g, "9")
    .replace(/(?:मॉड्यूल|माड्यूल|मॉड्युल|मोड्यूल)\s*(\d+)/gi, "Module $1")
    .replace(/(?:यूनिट|युनिट)\s*(\d+)/gi, "Unit $1")
    .replace(/(?:अध्याय|चैप्टर|चाप्टर)\s*(\d+)/gi, "Chapter $1");

  const activeLower = devanagariNormalized.toLowerCase();

  // 2. Extract Entities FIRST before removing stop words!
  const extractedEntities: ExtractedEntity[] = [];
  const structuralEntities: string[] = [];

  // A. Structural Entities (Module 4, Unit II, Chapter 7, Section B, etc.)
  const structMatches = devanagariNormalized.match(/\b(?:module|mod|chapter|chap|unit|section|part|lesson|page|table|schedule|topic)\s*[-#]?\s*(?:\d+|[ivxlcdm]+|[a-z])\b/gi);
  if (structMatches) {
    for (const sm of structMatches) {
      const { canonical, variants } = normalizeStructuralEntityName(sm);
      structuralEntities.push(canonical);
      extractedEntities.push({
        type: "structural",
        raw: sm,
        normalized: canonical,
        variants,
      });
    }
  }

  // B. Technical / Domain Acronyms & Subject Entities
  const domainPattern = /\b(?:dbms|sql|os|cn|dsa|ai|ml|se|cgpa|sgpa|hod|tt|ppt|html|css|javascript|python|java|c\+\+|cpp|json|csv|pdf)\b/gi;
  const domainMatches = activeQuery.match(domainPattern);
  if (domainMatches) {
    for (const dm of domainMatches) {
      extractedEntities.push({
        type: "domain",
        raw: dm,
        normalized: dm.toUpperCase(),
        variants: [dm.toLowerCase(), dm.toUpperCase()],
      });
    }
  }

  // C. Dates, Times, Room Numbers, Course Codes, Percentages
  const dateMatches = activeQuery.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/gi);
  if (dateMatches) {
    for (const dm of dateMatches) {
      extractedEntities.push({ type: "date", raw: dm, normalized: dm.toLowerCase(), variants: [dm.toLowerCase()] });
    }
  }

  const timeMatches = activeQuery.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje|o'clock|oclock)?\b|\b\d{1,2}:\d{2}\b/gi);
  if (timeMatches) {
    for (const tm of timeMatches) {
      const numMatch = tm.match(/\d{1,2}/);
      if (numMatch) {
        const hour = parseInt(numMatch[0], 10);
        if (hour >= 1 && hour <= 12) {
          const padded = hour < 10 ? `0${hour}` : `${hour}`;
          extractedEntities.push({
            type: "time",
            raw: tm,
            normalized: `${padded}:00`,
            variants: [`${padded}:00`, `${hour}:00`, `${padded}:00 AM`, `${hour}:00 AM`, `${padded}:00 PM`, `${hour}:00 PM`, `${hour} AM`, `${hour} PM`, `${hour} baje`, tm.toLowerCase()],
          });
        } else {
          extractedEntities.push({ type: "time", raw: tm, normalized: tm.toLowerCase(), variants: [tm.toLowerCase()] });
        }
      }
    }
  }

  const roomMatches = activeQuery.match(/\b(?:room|lab|hall|lt|audi|block|cabin)\s*[-#]?\s*[a-zA-Z0-9\-]+\b/gi);
  if (roomMatches) {
    for (const rm of roomMatches) {
      extractedEntities.push({ type: "room", raw: rm, normalized: rm.toLowerCase(), variants: [rm.toLowerCase()] });
    }
  }

  const codeMatches = activeQuery.match(/\b[A-Za-z]{2,5}\s*[-]?\s*\d{2,4}\b/g);
  if (codeMatches) {
    for (const cm of codeMatches) {
      extractedEntities.push({ type: "code", raw: cm, normalized: cm.toLowerCase(), variants: [cm.toLowerCase()] });
    }
  }

  // D. Days of Week Entities (Monday, Tuesday, Mon, Tue, etc.)
  const dayPatterns = [
    { name: "Monday", regex: /\b(?:monday|mon|somwar|somvaar)\b/i, variants: ["monday", "mon", "somwar"] },
    { name: "Tuesday", regex: /\b(?:tuesday|tue|mangalwar|mangalvaar)\b/i, variants: ["tuesday", "tue", "mangalwar"] },
    { name: "Wednesday", regex: /\b(?:wednesday|wed|budhwar|budhvaar)\b/i, variants: ["wednesday", "wed", "budhwar"] },
    { name: "Thursday", regex: /\b(?:thursday|thu|guruwar|guruvaar|brihaspatiwar)\b/i, variants: ["thursday", "thu", "guruwar"] },
    { name: "Friday", regex: /\b(?:friday|fri|shukrawar|shukravaar)\b/i, variants: ["friday", "fri", "shukrawar"] },
    { name: "Saturday", regex: /\b(?:saturday|sat|shaniwar|shanivaar)\b/i, variants: ["saturday", "sat", "shaniwar"] },
    { name: "Sunday", regex: /\b(?:sunday|sun|raviwar|ravivaar)\b/i, variants: ["sunday", "sun", "raviwar"] },
  ];
  for (const dp of dayPatterns) {
    if (dp.regex.test(activeQuery)) {
      extractedEntities.push({
        type: "date",
        raw: dp.name,
        normalized: dp.name,
        variants: dp.variants,
      });
    }
  }

  // E. Timetable / Schedule Entities
  if (/\b(?:timetable|time table|schedule|routine)\b/i.test(activeQuery)) {
    extractedEntities.push({
      type: "domain",
      raw: "timetable",
      normalized: "TIMETABLE",
      variants: ["timetable", "time table", "schedule", "routine", "time-table"],
    });
  }

  // F. Lab / Labs Entities
  if (/\b(?:lab|labs|practical|practicals)\b/i.test(activeQuery)) {
    extractedEntities.push({
      type: "domain",
      raw: "lab",
      normalized: "LAB",
      variants: ["lab", "labs", "practical", "practicals"],
    });
  }

  // 3. Intent Classification
  let intent: ParsedMultilingualQuery["intent"] = "SYLLABUS_CONTENT";

  if (/\b(?:kab|date|time|schedule|timetable|timing|exam|when|routine|day|period)\b/i.test(activeLower)) {
    intent = "SCHEDULE_EXAM";
  } else if (/\b(?:kahan|kidhar|where|room|hall|lab|venue|location|building|block)\b/i.test(activeLower)) {
    intent = "LOCATION_VENUE";
  } else if (/\b(?:kitna|kitne|kitni|fee|fees|cost|marks|score|percentage|credit|credits|price|amount|how much|how many)\b/i.test(activeLower)) {
    intent = "NUMERIC_FEE";
  } else if (/\b(?:kaun|kon|who|faculty|prof|professor|teacher|instructor|coordinator|hod)\b/i.test(activeLower)) {
    intent = "FACULTY_PERSON";
  } else if (/\b(?:kya|mein kya|me kya|topics|syllabus|content|subject|overview|detail|explain|batao|samjhao|padhna|what is|tell me|explain karo|describe)\b/i.test(activeLower)) {
    intent = "SYLLABUS_CONTENT";
  } else if (/\b(?:matlab|meaning|definition|define|means)\b/i.test(activeLower)) {
    intent = "GENERAL_EXPLAIN";
  }

  // 4. Clean Keywords (Strip language question stop-words while keeping core nouns/entities)
  const langQuestionStopWords = new Set<string>([
    // Hinglish / Hindi stop words
    "kya", "hai", "he", "mein", "me", "ka", "ke", "ki", "kaa", "kee", "kay", "ko", "se", "par",
    "batao", "bata", "do", "bataiye", "samjhao", "samjhaao", "samjhaiye", "padhna",
    "padhnai", "explain", "karo", "karna", "hoga", "hogi", "honge", "kya-kya", "shamil",
    "antargat", "matlab", "kitne", "kitni", "kitna", "kab", "kahan", "kidhar", "kaun", "kaise",
    "kaunse", "kaunsi", "hain", "kis", "kisme", "kisko", "karein",
    "chahiye", "iske", "isko", "isme", "ismein", "kon", "konsa", "kaunsa", "bol", "bho",
    // Devanagari stop words
    "क्या", "है", "में", "का", "के", "की", "बताओ", "समझाओ", "पढ़ना", "करो", "करना", "कितने", "कितना", "कब", "कहाँ", "कौन", "कौनसे", "कौनसी", "हैं", "किस",
    // Marathi stop words
    "madhe", "kay", "aahe", "ahe", "che", "sang", "sanga", "sangna", "mahit", "dya", "konta", "konti", "konte",
    "मध्ये", "आहे", "सांगा", "कोणते", "बद्दल",
    // English stop words
    "what", "is", "are", "the", "in", "of", "tell", "me", "about", "explain", "topics", "content",
    "syllabus", "does", "have", "give", "which", "show", "detail", "details", "info", "information"
  ]);

  const rawTokens = activeLower.split(/[\s,.;:!?`"'()\[\]{}]+/).filter(Boolean);
  const cleanKeywords: string[] = [];

  for (const t of rawTokens) {
    if (!langQuestionStopWords.has(t) && t.length > 1) {
      cleanKeywords.push(t);
    }
  }

  // 5. Generate Internal Multilingual Search Expansion Variants
  const expandedSearchVariants = new Set<string>();

  // Always include structural entity variants
  for (const structEnt of structuralEntities) {
    const { canonical, variants } = normalizeStructuralEntityName(structEnt);
    for (const v of variants) {
      expandedSearchVariants.add(v);
    }

    if (intent === "SYLLABUS_CONTENT" || intent === "GENERAL_EXPLAIN") {
      expandedSearchVariants.add(`${canonical} topics`);
      expandedSearchVariants.add(`${canonical} syllabus`);
      expandedSearchVariants.add(`${canonical} content`);
      expandedSearchVariants.add(`${canonical} overview`);
      expandedSearchVariants.add(`${canonical} subjects`);
      expandedSearchVariants.add(`${canonical} chapter`);
      expandedSearchVariants.add(`${canonical} unit`);
    } else if (intent === "SCHEDULE_EXAM") {
      expandedSearchVariants.add(`${canonical} exam`);
      expandedSearchVariants.add(`${canonical} schedule`);
      expandedSearchVariants.add(`${canonical} date`);
      expandedSearchVariants.add(`${canonical} time`);
    }
  }

  // Add domain entity combinations
  for (const ent of extractedEntities) {
    if (ent.type === "domain") {
      for (const v of ent.variants) {
        expandedSearchVariants.add(v);
      }
    }
  }

  // If clean keywords exist, create composite search query
  if (cleanKeywords.length > 0) {
    expandedSearchVariants.add(cleanKeywords.join(" "));
  }

  return {
    rawQuery: qTrim,
    detectedLang,
    intent,
    entities: extractedEntities,
    structuralEntities,
    cleanKeywords,
    expandedSearchVariants: Array.from(expandedSearchVariants),
    isFollowUp,
    resolvedContextQuery: activeQuery,
  };
}

// -------------------------------------------------------------------------
// 4. MULTILINGUAL CHUNK SCORING & ANCHORING
// -------------------------------------------------------------------------

export interface MultilingualChunkScore {
  rawScore: number;
  normalizedScore: number;
  reasons: string[];
  isStructuralAnchor: boolean;
  matchedEntities: string[];
}

export function scoreChunkMultilingual(
  chunk: any,
  parsedQuery: ParsedMultilingualQuery,
  totalChunksCount: number,
  pass2Relaxed = false
): MultilingualChunkScore | null {
  const contentLower = (chunk.content || "").toLowerCase();
  const filePath = chunk.file_id || "document";
  const baseNameLower = filePath.split(/[\/\\]/).pop().toLowerCase();
  const symbolLower = (chunk.symbol || "").toLowerCase();

  let rawScore = 0;
  const reasons: string[] = [];
  const matchedEntities: string[] = [];
  let isStructuralAnchor = false;

  // Signal A: Structural Entity Anchor Match (Highest priority signal)
  // Example: Query asks for "Module 4", chunk contains "MODULE 4" or symbol is "Module 4"
  for (const structEnt of parsedQuery.structuralEntities) {
    const { canonical, variants } = normalizeStructuralEntityName(structEnt);
    let matchedVariant = "";

    for (const v of variants) {
      const vLower = v.toLowerCase();
      if (contentLower.includes(vLower) || symbolLower.includes(vLower) || baseNameLower.includes(vLower)) {
        matchedVariant = v;
        break;
      }
    }

    if (matchedVariant) {
      rawScore += 75;
      isStructuralAnchor = true;
      reasons.push(`Structural anchor match: "${canonical}" (via "${matchedVariant}")`);
      matchedEntities.push(canonical);
    }
  }

  // Signal B: Domain & Specific Entity Matches (Acronyms, dates, times, rooms, course codes)
  for (const ent of parsedQuery.entities) {
    if (ent.type !== "structural") {
      for (const v of ent.variants) {
        if (contentLower.includes(v.toLowerCase())) {
          rawScore += 35;
          reasons.push(`Exact entity match: "${ent.normalized}"`);
          matchedEntities.push(ent.normalized);
          break;
        }
      }
    }
  }

  // Signal C: Exact Query Full Phrase Match
  const qLower = parsedQuery.rawQuery.toLowerCase();
  if (contentLower.includes(qLower)) {
    rawScore += 65;
    reasons.push("Exact query phrase match");
  }

  // Signal D: Clean Keywords Match (Excludes question filler stop-words!)
  let cleanKeywordMatches = 0;
  const getKwVariants = (w: string): string[] => {
    const list = [w];
    if (w.endsWith("s") && w.length > 3) list.push(w.slice(0, -1));
    if (w === "timetable") list.push("time table", "time", "table");
    if (w === "monday") list.push("mon");
    if (w === "tuesday") list.push("tue");
    if (w === "wednesday") list.push("wed");
    if (w === "thursday") list.push("thu");
    if (w === "friday") list.push("fri");
    if (w === "saturday") list.push("sat");
    if (w === "sunday") list.push("sun");
    if (w === "labs") list.push("lab");
    return list;
  };

  for (const kw of parsedQuery.cleanKeywords) {
    // Skip generic structural words if structural entity was requested but not matched in this chunk
    if (parsedQuery.structuralEntities.length > 0 && !isStructuralAnchor && (kw === "module" || kw === "unit")) {
      continue;
    }
    const variants = getKwVariants(kw);
    let matched = false;
    for (const kv of variants) {
      if (contentLower.includes(kv)) {
        matched = true;
        cleanKeywordMatches++;
        const occurrences = (contentLower.match(new RegExp(kv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g")) || []).length;
        rawScore += Math.min(20, 4 + occurrences * 3);
        break;
      }
      if (symbolLower && symbolLower.includes(kv)) {
        matched = true;
        rawScore += 12;
        reasons.push(`Section header match: "${chunk.symbol}"`);
        break;
      }
    }
  }

  // Signal E: Table Row & Coordinate Intersection Match
  if (contentLower.includes("|")) {
    const tableLines = contentLower.split("\n").filter(l => l.trim().startsWith("|"));
    if (tableLines.length >= 2 && parsedQuery.cleanKeywords.length >= 2) {
      for (const line of tableLines) {
        const matchingKws = parsedQuery.cleanKeywords.filter(k => {
          const variants = getKwVariants(k);
          return variants.some(v => line.includes(v));
        });
        if (matchingKws.length >= 2) {
          rawScore += 35;
          reasons.push(`Table row intersection match (${matchingKws.join(", ")})`);
          break;
        }
      }
    }
  }

  // Anti-hallucination check: If query explicitly asks for a structural entity (e.g., "Module 99"),
  // but chunk does not contain that structural entity, reject non-anchor hits unless score is high.
  if (parsedQuery.structuralEntities.length > 0 && !isStructuralAnchor && rawScore < 35) {
    return null;
  }

  if (cleanKeywordMatches > 0) {
    reasons.push(`Matched ${cleanKeywordMatches}/${parsedQuery.cleanKeywords.length} core keywords`);
  }

  // Signal F: Expanded Search Variants Matching
  for (const variant of parsedQuery.expandedSearchVariants) {
    const varLower = variant.toLowerCase();
    if (varLower.length > 3 && contentLower.includes(varLower)) {
      rawScore += 15;
    }
  }

  // Precision Evaluation & Normalization
  if (rawScore < (pass2Relaxed ? 12 : 15)) {
    return null;
  }

  // Calculate normalized score in range [0.35, 0.99]
  const baseNormalized = 0.35 + (rawScore / (rawScore + 30)) * 0.63;
  const normalizedScore = Math.min(0.99, Math.max(0.35, Number(baseNormalized.toFixed(2))));

  return {
    rawScore,
    normalizedScore,
    reasons: Array.from(new Set(reasons)),
    isStructuralAnchor,
    matchedEntities: Array.from(new Set(matchedEntities)),
  };
}

// -------------------------------------------------------------------------
// 5. GROUNDED PROMPT BUILDER WITH USER LANGUAGE MATCHING
// -------------------------------------------------------------------------

export function buildMultilingualGroundedPrompt(params: {
  parsedQuery: ParsedMultilingualQuery;
  groundedContext: string;
  documentNames: string[];
}): string {
  const { parsedQuery, groundedContext } = params;

  if (!groundedContext || !groundedContext.trim()) {
    return parsedQuery.rawQuery;
  }

  let languageGuidance = "";
  const lang = parsedQuery.detectedLang;

  if (lang.isHinglish) {
    languageGuidance = `- **RESPONSE LANGUAGE**: Reply in natural, easy-to-understand **Hinglish (Hindi written in Roman script)**. For example: "Module 4 mein Database Management Systems topic hai...". Keep technical terms (DBMS, SQL, Normalization) in standard English.`;
  } else if (lang.code === "hi") {
    languageGuidance = `- **RESPONSE LANGUAGE**: Reply in fluent **Hindi (Devanagari script)**. Keep technical terms clear.`;
  } else if (lang.code === "mr" || lang.code === "roman_mr") {
    languageGuidance = `- **RESPONSE LANGUAGE**: Reply in **Marathi / Romanized Marathi** as requested by the user.`;
  } else if (lang.code !== "en") {
    languageGuidance = `- **RESPONSE LANGUAGE**: Reply in the detected user language (${lang.displayName}).`;
  } else {
    languageGuidance = `- **RESPONSE LANGUAGE**: Reply in clear, professional **English**.`;
  }

  return `DOCUMENT & MULTI-DOCUMENT KNOWLEDGE CONTEXT (Ground Truth):
${groundedContext}

==================================================
CRITICAL MULTILINGUAL & FACTUAL INSTRUCTIONS
==================================================
1. **FACT GROUNDING & CONCEPTUAL CAPABILITY**:
   - For queries specifically inquiring about uploaded documents, files, syllabus, policies, schedules, or project code: ground answers accurately in the provided context without hallucinating fake facts.
   - For general conceptual, mathematical, educational, algorithmic, technical, or programming questions (e.g. "what is probability", "probbility kya hoti hai", "what is recursion", "explain binary search", "how does oauth work", "solve equation"): ALWAYS answer the question directly, thoroughly, and helpfully using universal knowledge and structured formatting! NEVER refuse to answer or say "Mujhe package-lock.json / uploaded files mein information nahi mili".
   - Only state that information was not found if the user is explicitly searching for a specific document-scoped entity (e.g. "Is topic X in module 4?", "What is in chapter 8?") that does not exist in the uploaded document.

2. ${languageGuidance}

3. **ENTITY & TECHNICAL ACCURACY**:
   - Keep names of Modules, Units, Chapters, Subjects, Codes, and Technical terms exact (e.g. "Module 4", "DBMS", "SQL", "Relational Model").

4. **MULTI-DOCUMENT SYNTHESIS & CONFLICTS**:
   - If information comes from multiple files, mention the source document names cleanly.
   - If two uploaded files contain conflicting facts (e.g. conflicting dates or times), point out the conflict explicitly with document names.

5. **TABLE & LIST FORMATTING**:
   - When presenting syllabus topics, schedules, or tables, use clear bullet points or clean Markdown tables.

USER QUESTION:
${parsedQuery.rawQuery}`;
}
