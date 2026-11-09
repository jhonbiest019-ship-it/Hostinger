const s = "2026-10-24T10:00";
const d = new Date(s);
console.log("Input string:", s);
console.log("new Date(s).toISOString():", d.toISOString());

const formatted = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Karachi",
}).format(d);

console.log("Formatted in Asia/Karachi:", formatted);
