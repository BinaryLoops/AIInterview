import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Data Transfer Object for completing login via six-digit OTP challenge.
 *
 * Accepts email and 6-digit numeric OTP (or alias `code`).
 */
export class VerifyLoginOtpDto {
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
}
