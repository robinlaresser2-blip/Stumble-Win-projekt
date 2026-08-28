const figlet = require('figlet');
class Console {
  static log(type, ...args) {
    const color = 34;
    console.log(`\x1b[${color}m[${type}]\x1b[0m`, ...args);
  }
  static rooms(type, ...args) {
    const color = 35;
    console.log(`\x1b[${color}m[${type}]\x1b[0m`, ...args);
  }
  static warn(type, ...args) {
    console.log(`\x1b[33m[${type}]\x1b[0m`, ...args);
  }

  static error(type, ...args) {
    console.log(`\x1b[31m[${type}]\x1b[0m`, ...args);
  }
  static async bigLog(text, color = 34, font = 'ANSI Shadow') {
    return new Promise((resolve, reject) => {
      figlet.text(text, { font }, (err, data) => {
        if (err) {
          console.log(`\x1b[31m[BigLogError]\x1b[0m Erro ao gerar BigLog:`, err);
          reject(err);
          return;
        }
        const lines = data
          .split('\n')
          .map(line => `\x1b[${color}m${line}\x1b[0m`)
          .join('\n');
        console.log(lines);
        resolve();
      });
    });
  }
}

module.exports = Console;
