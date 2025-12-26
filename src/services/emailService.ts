import { Resend } from 'resend';
import type { Env } from '../config/index.js';

export class EmailService {
  private resend: Resend | null = null;
  private fromEmail: string;
  private appUrl: string;

  constructor(config: Env) {
    if (config.RESEND_API_KEY) {
      this.resend = new Resend(config.RESEND_API_KEY);
    }
    this.fromEmail = config.EMAIL_FROM;
    this.appUrl = config.APP_URL;
  }

  isConfigured(): boolean {
    return this.resend !== null;
  }

  async sendInvitationEmail(params: {
    to: string;
    inviterName: string | null;
    organizationName: string;
    role: string;
    token: string;
    workspaceName?: string | null;
  }): Promise<boolean> {
    if (!this.resend) {
      console.log('[Email] Resend not configured, skipping invitation email to:', params.to);
      return false;
    }

    const inviteUrl = `${this.appUrl}/invite/${params.token}`;
    const inviterText = params.inviterName || 'Someone';
    const workspaceText = params.workspaceName
      ? ` and the "${params.workspaceName}" workspace`
      : '';

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: params.to,
        subject: `You've been invited to join ${params.organizationName}`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Team Planner</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1f2937; margin-top: 0;">You're Invited!</h2>

    <p style="color: #4b5563;">
      ${inviterText} has invited you to join <strong>${params.organizationName}</strong>${workspaceText} as a <strong>${params.role}</strong>.
    </p>

    <p style="color: #4b5563;">
      Team Planner helps teams plan their weekly and monthly capacity, assign tasks with time estimates, and avoid overloads.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${inviteUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Accept Invitation
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      Or copy and paste this link into your browser:<br>
      <a href="${inviteUrl}" style="color: #667eea; word-break: break-all;">${inviteUrl}</a>
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
      This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
        `.trim(),
      });

      console.log('[Email] Invitation email sent to:', params.to);
      return true;
    } catch (error) {
      console.error('[Email] Failed to send invitation email:', error);
      return false;
    }
  }

  async sendPasswordResetEmail(params: {
    to: string;
    userName: string | null;
    token: string;
  }): Promise<boolean> {
    if (!this.resend) {
      console.log('[Email] Resend not configured, skipping password reset email to:', params.to);
      return false;
    }

    const resetUrl = `${this.appUrl}/reset-password?token=${params.token}`;
    const greeting = params.userName ? `Hi ${params.userName}` : 'Hello';

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: params.to,
        subject: 'Reset your Team Planner password',
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Team Planner</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1f2937; margin-top: 0;">${greeting},</h2>

    <p style="color: #4b5563;">
      We received a request to reset your password. Click the button below to create a new password:
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Reset Password
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      Or copy and paste this link into your browser:<br>
      <a href="${resetUrl}" style="color: #667eea; word-break: break-all;">${resetUrl}</a>
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
      This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
        `.trim(),
      });

      console.log('[Email] Password reset email sent to:', params.to);
      return true;
    } catch (error) {
      console.error('[Email] Failed to send password reset email:', error);
      return false;
    }
  }

  async sendEmailVerificationEmail(params: {
    to: string;
    userName: string | null;
    token: string;
  }): Promise<boolean> {
    if (!this.resend) {
      console.log('[Email] Resend not configured, skipping verification email to:', params.to);
      return false;
    }

    const verifyUrl = `${this.appUrl}/verify-email?token=${params.token}`;
    const greeting = params.userName ? `Hi ${params.userName}` : 'Hello';

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: params.to,
        subject: 'Verify your Team Planner email',
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Team Planner</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1f2937; margin-top: 0;">${greeting},</h2>

    <p style="color: #4b5563;">
      Thanks for signing up! Please verify your email address by clicking the button below:
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Verify Email
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      Or copy and paste this link into your browser:<br>
      <a href="${verifyUrl}" style="color: #667eea; word-break: break-all;">${verifyUrl}</a>
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
      This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
        `.trim(),
      });

      console.log('[Email] Verification email sent to:', params.to);
      return true;
    } catch (error) {
      console.error('[Email] Failed to send verification email:', error);
      return false;
    }
  }

  async sendWelcomeEmail(params: {
    to: string;
    userName: string | null;
    organizationName: string;
  }): Promise<boolean> {
    if (!this.resend) {
      console.log('[Email] Resend not configured, skipping welcome email to:', params.to);
      return false;
    }

    const dashboardUrl = this.appUrl;
    const greeting = params.userName ? `Hi ${params.userName}` : 'Welcome';

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: params.to,
        subject: `Welcome to ${params.organizationName} on Team Planner!`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Team Planner</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1f2937; margin-top: 0;">${greeting}!</h2>

    <p style="color: #4b5563;">
      You've successfully joined <strong>${params.organizationName}</strong> on Team Planner.
    </p>

    <p style="color: #4b5563;">
      You can now:
    </p>

    <ul style="color: #4b5563;">
      <li>View and manage tasks assigned to you</li>
      <li>Track your weekly capacity</li>
      <li>Collaborate with your team</li>
    </ul>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${dashboardUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Go to Dashboard
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
      Need help? Reply to this email or check out our documentation.
    </p>
  </div>
</body>
</html>
        `.trim(),
      });

      console.log('[Email] Welcome email sent to:', params.to);
      return true;
    } catch (error) {
      console.error('[Email] Failed to send welcome email:', error);
      return false;
    }
  }
}
