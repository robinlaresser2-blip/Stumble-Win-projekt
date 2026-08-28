const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const fs = require("fs").promises;
const { v4: uuidv4 } = require("uuid");

class CryptoUtils {
  static LoginSalt = process.env.LoginSalt;
  static Salt = process.env.Salt || "";
  static SharedSalt = process.env.SharedSalt;

  static async WriteJson(path, json) {
    await fs.writeFile(`${path}.json`, JSON.stringify(json, null, 2));
  }

  static GenerateId() {
    return crypto.randomBytes(16).toString("hex");
  }

  static Encrypt(text) {
    const key = crypto.createHash("sha256").update(this.Salt).digest().slice(0, 16);
    const iv = Buffer.alloc(16, 0);
    const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
    let encrypted = cipher.update(text, "utf8", "base64");
    encrypted += cipher.final("base64");
    return encrypted;
  }

  static Decrypt(encryptedString) {
    const key = crypto.createHash("sha256").update(this.Salt).digest().slice(0, 16);
    const iv = Buffer.alloc(16, 0);
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    let decrypted = decipher.update(encryptedString, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  static UltraEncrypt(text) {
    const salt = Buffer.from(process.env.Salt, "hex");
    const key = crypto.pbkdf2Sync(this.Salt, salt, 100000, 32, "sha512");
    const iv = crypto.createHash("md5").update(salt).digest();

    let chars = text.split('');
    const insertionStr = ".gg/StumbleHub";
    const insertions = 8;

    const interval = Math.floor(chars.length / insertions) || 1;
    for (let i = 0; i < insertions; i++) {
      let pos = Math.min(i * interval + i, chars.length);
      chars.splice(pos, 0, insertionStr);
    }

    const confusedText = chars.join('');

    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(confusedText, "utf8"), cipher.final()]);

    return encrypted.toString("latin1");
  }

  static UltraDecrypt(encrypted) {
    const salt = Buffer.from(process.env.Salt, "hex");
    const key = crypto.pbkdf2Sync(this.Salt, salt, 100000, 32, "sha512");
    const iv = crypto.createHash("md5").update(salt).digest();

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, "latin1")), decipher.final()]);

    const cleanText = decrypted.toString("utf8").replace(/\.gg\/beastsg/g, '').trim();

    return cleanText;
  }

  static Hash(type, input) {
    return crypto.createHash(type).update(input).digest("hex");
  }

  static CreateJWT(payload, secret) {
    const options = { algorithm: "HS256" };
    return jwt.sign(payload, secret, options);
  }

  static gerarAverageMmr() {
    const min = 0xd00000;
    const max = 0xdfffff;
    const mmr = Math.floor(Math.random() * (max - min + 1)) + min;
    return mmr.toString(16).toUpperCase();
  }

  static createJWTV2(payload, signature) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    if (!signature.includes(":")) throw new Error("Invalid signature format");
    const signatureKey = signature.split(":")[1];
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signatureHash = crypto.createHmac("sha1", signatureKey).update(signingInput).digest("base64url");
    return `${encodedHeader}.${encodedPayload}.${signatureHash}`;
  }

  static DecodeJWT(encoded) {
    const decoded = jwt.decode(encoded, { complete: true });
    if (!decoded || !decoded.payload) throw new Error("Invalid JWT token");
    return decoded.payload;
  }

  static CreateLoginHash(deviceId, id, stumbleId, version) {
    const text = this.LoginSalt + deviceId + id + stumbleId + version;
    return this.Hash("sha1", text);
  }

  static CreateRegularHash(username, id, deviceId, token, stumbleId, url, body) {
    if (!body)
    {
      body = "NULL";
    }
    const text = this.Salt + username + id + deviceId + token + stumbleId + url;
    return this.Hash("sha1", text);
  }

  static CreateSharedHash(sharedData, timestamp, deviceId) {
    const text = this.SharedSalt + sharedData + timestamp + deviceId;
    return this.Hash("sha1", text);
  }

  static CreateParms(type) {
    return uuidv4();
  }

  static CreateParmsV2() {
    const genText = () =>
      Buffer.from(
        Array.from({ length: 34 }, () => Math.random().toString(34)[2]).join("")
      ).toString("base64");
    return genText();
  }

  static CreateGameId(type) {
    return uuidv4();
  }

  static SessionToken() {
    const buffer = crypto.randomBytes(16);
    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  static GenCaracters(amount) {
    const possibleChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < amount; i++) {
      const idx = crypto.randomInt(possibleChars.length);
      result += possibleChars[idx];
    }
    return result;
  }

  static GenAndroidId() {
    return uuidv4().replace(/-/g, "");
  }

  static GenWebGlId() {
    return "webgl_" + this.GenAndroidId();
  }

  static GenIosId() {
    return uuidv4().toUpperCase();
  }

  static formatNumber(number) {
    if (typeof number !== "number") return "undefined";
    return number.toLocaleString("en-US");
  }
}

module.exports = CryptoUtils;
