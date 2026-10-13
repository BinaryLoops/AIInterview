import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * Data Transfer Object for requesting a password reset verification code.
 *
 * Enforces valid email syntax and maximum length constraints.
 * Unknown fields are rejected by the GlobalValidationPipe.
 */
export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @IsNotEmpty({ message: 'Email address is required.' })
  @MaxLength(320, { message: 'Email address must not exceed 320 characters.' })
  email!: string;
}
