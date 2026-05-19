/// <reference types="astro" />

declare namespace Astro {
  export interface Locals {
    runtime: {
      env: {
        DB: D1Database;
        GOOGLE_CLIENT_ID: string;
        GOOGLE_CLIENT_SECRET: string;
        RESEND_API_KEY: string;
        FOUNDER_EMAIL?: string;
        GITHUB_TOKEN?: string;
      };
    };
    user?: {
      id: number;
      email: string;
      role: string;
      approved: number;
      banned: number;
      suspendedUntil: string | null;
    };
  }
}