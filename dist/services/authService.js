import { randomBytes } from 'crypto';
import { hashPassword, verifyPassword } from '../utils/password.js';
export class AuthService {
    constructor(fastify) {
        this.fastify = fastify;
    }
    async register(email, password, name) {
        const passwordHash = await hashPassword(password);
        const result = await this.fastify.db.query(`INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, capacity_week_hours, timezone, is_active, created_at, updated_at`, [email, passwordHash, name || null]);
        const user = result.rows[0];
        const tokens = await this.generateTokens(user);
        return {
            user: this.toPublicUser(user),
            ...tokens,
        };
    }
    async login(email, password) {
        const result = await this.fastify.db.query(`SELECT * FROM users WHERE email = $1 AND is_active = true`, [email]);
        const user = result.rows[0];
        if (!user)
            return null;
        const isValid = await verifyPassword(password, user.password_hash);
        if (!isValid)
            return null;
        const tokens = await this.generateTokens(user);
        return {
            user: this.toPublicUser(user),
            ...tokens,
        };
    }
    async refresh(refreshToken) {
        const result = await this.fastify.db.query(`SELECT rt.*, u.email FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token = $1 AND rt.expires_at > NOW()`, [refreshToken]);
        const tokenRow = result.rows[0];
        if (!tokenRow)
            return null;
        const accessToken = this.fastify.jwt.sign({
            id: tokenRow.user_id,
            email: tokenRow.email,
        });
        return { accessToken };
    }
    async logout(refreshToken) {
        await this.fastify.db.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refreshToken]);
    }
    async generateTokens(user) {
        const accessToken = this.fastify.jwt.sign({
            id: user.id,
            email: user.email,
        });
        const refreshToken = randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30); // 30 days
        await this.fastify.db.query(`INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`, [user.id, refreshToken, expiresAt]);
        return { accessToken, refreshToken };
    }
    toPublicUser(user) {
        const { password_hash, ...publicUser } = user;
        return publicUser;
    }
}
//# sourceMappingURL=authService.js.map