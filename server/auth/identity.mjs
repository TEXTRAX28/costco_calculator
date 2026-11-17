import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((email) => email.toLowerCase());
export const passwordSchema = z.string().min(1).max(256);
export const newPasswordSchema = passwordSchema.refine(
  (password) =>
    Array.from(password).length >= 15 && Array.from(password).length <= 128,
);

export const identitySchema = z.strictObject({
  issuer: z.url({ protocol: /^https$/ }).max(256),
  subject: z.string().min(1).max(255),
  email: emailSchema,
  authenticatedAt: z.number().int().nonnegative(),
});
