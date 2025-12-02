export function log(...args) {
  console.log(new Date().toISOString(), "[INFO]", ...args);
}

export function warn(...args) {
  console.warn(new Date().toISOString(), "[WARN]", ...args);
}

export function error(...args) {
  console.error(new Date().toISOString(), "[ERROR]", ...args);
}
