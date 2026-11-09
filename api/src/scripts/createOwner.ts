import { db } from '../db';
import { hashSecret } from '../lib/auth';
import { newId, now } from '../lib/ids';

async function main() {
  const [email, password, ...name] = process.argv.slice(2);
  if (!email || !password || password.length < 12 || !name.length) {
    console.error('Usage: npm run staff:owner -- YOUR_EMAIL@fakeemail.com "YOUR_PASSWORD" YOUR_NAME');
    process.exit(1);
  }
  const lower = email.toLowerCase();
  if (db.prepare('SELECT 1 FROM staff WHERE email = ?').get(lower)) {
    console.error('That email already has a staff account');
    process.exit(1);
  }
  db.prepare("INSERT INTO staff (id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,'owner',?)").run(newId(), lower, name.join(' '), await hashSecret(password), now());
  console.log(`Owner ${lower} created`);
}
void main();
