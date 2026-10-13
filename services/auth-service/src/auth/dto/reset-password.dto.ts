import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Data Transfer Object for completing a password reset challenge.
 *
 * Accepts the user's email, the 6-digit numeric OTP code (or code alias),
 * and the new password with its confirmation.
 * Strict class-validator rules protect against malformed payloads and
 * unwhitelisted properties (enforced by GlobalValidationPipe).
 */
export class ResetPasswordDto {
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @IsNotEmpty({ message: 'Email address is required.' })
  @MaxLength(320, { message: 'Email address must not exceed 320 characters.' })
  email!: string;

  @IsOptional()
  @IsString({ message: 'Verification OTP must be a string.' })
  @Length(6, 6, { message: 'Verification OTP must be exactly 6 digits.' })
  @Matches(/^\d{6}$/, { message: 'Verification OTP must contain only numbers.' })
  otp?: string;

  @IsOptional()
  @IsString({ message: 'Verification code must be a string.' })
  @Length(6, 6, { message: 'Verification code must be exactly 6 digits.' })
  @Matches(/^\d{6}$/, { message: 'Verification code must contain only numbers.' })
  code?: string;

  @IsOptional()
  @IsString({ message: 'New password must be a string.' })
  @MinLength(12, { message: 'New password must be at least 12 characters long.' })
  @MaxLength(128, { message: 'New password must not exceed 128 characters.' })
  newPassword?: string;

  @IsOptional()
  @IsString({ message: 'Password must be a string.' })
  @MinLength(12, { message: 'Password must be at least 12 characters long.' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters.' })
  password?: string;

  @IsOptional()
  @IsString({ message: 'Password confirmation must be a string.' })
  @MaxLength(128, { message: 'Password confirmation must not exceed 128 characters.' })
  passwordConfirmation?: string;

  @IsOptional()
  @IsString({ message: 'Confirm password must be a string.' })
  @MaxLength(128, { message: 'Confirm password must not exceed 128 characters.' })
  confirmPassword?: string;
}
