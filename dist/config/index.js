import { z } from 'zod';
const envSchema = z.object({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    PORT: z.string().default('3000').transform(Number),
    HOST: z.string().default('0.0.0.0'),
});
export function loadConfig() {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
        console.error('Invalid environment variables:');
        console.error(result.error.format());
        throw new Error('Invalid environment variables');
    }
    return result.data;
}
//# sourceMappingURL=index.js.map