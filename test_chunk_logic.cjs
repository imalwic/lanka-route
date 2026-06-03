const cleanText = "සීගිරිය යනු ශ්‍රී ලංකාවේ මාතලේ දිස්ත්‍රික්කයේ පිහිටා ඇති අතිශය වැදගත් ඓතිහාසික හා පුරාවිද්‍යාත්මක වටිනාකමකින් යුත් පර්වත බලකොටුවකි. එය සිංහගිරිය යනුවෙන්ද හැඳින්වෙන අතර ලෝකයේ අටවන පුදුමය ලෙසද බොහෝ දෙනා සලකති! මෙය ඉතාම ලස්සන තැනක්ද? ඔව්.";
const rawChunks = cleanText.replace(/([.!?])\s+/g, "$1|").split("|");
const chunks = [];

rawChunks.forEach(sentence => {
    let s = sentence.trim();
    if (!s) return;
    
    if (s.length < 190) {
        chunks.push(s);
    } else {
        const words = s.split(' ');
        let curr = "";
        for (const w of words) {
            if (curr.length + w.length + 1 > 180) {
                if (curr.trim().length > 0) chunks.push(curr.trim());
                curr = w;
            } else {
                curr += (curr.length > 0 ? " " : "") + w;
            }
        }
        if (curr.trim().length > 0) chunks.push(curr.trim());
    }
});

console.log(chunks);
