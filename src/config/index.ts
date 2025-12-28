import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  PORT: z.string().default('3000').transform(Number),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // App URL for email links
  APP_URL: z.string().url().default('http://localhost:5173'),
  // Stripe (optional - billing features disabled if not set)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  // Email (optional - email features disabled if not set)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default('noreply@example.com'),
  // AI (optional - AI features disabled if not set)
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_DEFAULT_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
  AI_DEFAULT_MODEL: z.string().default('gpt-4o-mini'),
  AI_MAX_TOKENS_PER_REQUEST: z.string().default('4000').transform(Number),
  AI_TEMPERATURE: z.string().default('0.7').transform(Number),
  AI_MONTHLY_TOKEN_LIMIT_DEFAULT: z.string().default('200000').transform(Number),
});

export type Env = z.infer<typeof envSchema>;

export function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    throw new Error('Invalid environment variables');
  }

  return result.data;
}
