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
 * Data Transfer Object for email verification requests.
 *
 * Rejects malformed codes, non-numeric values, invalid lengths,
 * and unwhitelisted fields before invoking internal verification services.
 */
export class VerifyEmailDto {
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @IsNotEmpty({ message: 'Email address is required.' })
  @MaxLength(320, { message: 'Email address must not exceed 320 characters.' })
  email!: string;

  @IsOptional()
  @IsString({ message: 'OTP must be a string.' })
  @Length(6, 6, { message: 'OTP must be exactly 6 digits.' })
  @Matches(/^\d{6}$/, { message: 'OTP must contain only digits.' })
  otp?: string;

  @IsOptional()
  @IsString({ message: 'Verification code must be a string.' })
  @Length(6, 6, { message: 'Verification code must be exactly 6 digits.' })
  @Matches(/^\d{6}$/, { message: 'Verification code must contain only digits.' })
  code?: string;
}
