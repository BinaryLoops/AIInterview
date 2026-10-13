import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Data Transfer Object for public candidate registration requests.
 *
 * Strict class-validator rules protect the service against malformed values,
 * oversized payloads, and unwhitelisted fields (enforced by GlobalValidationPipe).
 */
export class RegisterDto {
  @IsString({ message: 'Full name must be a string.' })
  @IsNotEmpty({ message: 'Full name is required.' })
  @MinLength(2, { message: 'Full name must be at least 2 characters long.' })
  @MaxLength(100, { message: 'Full name must not exceed 100 characters.' })
  fullName!: string;

  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @IsNotEmpty({ message: 'Email address is required.' })
  @MaxLength(320, { message: 'Email address must not exceed 320 characters.' })
  email!: string;

  @IsOptional()
  @IsString({ message: 'Mobile number must be a string.' })
  @MaxLength(20, { message: 'Mobile number must not exceed 20 characters.' })
  mobileNumber?: string;

  @IsOptional()
  @IsString({ message: 'Phone number must be a string.' })
  @MaxLength(20, { message: 'Phone number must not exceed 20 characters.' })
  phone?: string;

  @IsString({ message: 'Password must be a string.' })
  @IsNotEmpty({ message: 'Password is required.' })
  @MinLength(12, { message: 'Password must be at least 12 characters long.' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters.' })
  password!: string;

  @IsOptional()
  @IsString({ message: 'Password confirmation must be a string.' })
  @MaxLength(128, { message: 'Password confirmation must not exceed 128 characters.' })
  passwordConfirmation?: string;

  @IsOptional()
  @IsString({ message: 'Confirm password must be a string.' })
  @MaxLength(128, { message: 'Confirm password must not exceed 128 characters.' })
  confirmPassword?: string;

  @IsOptional()
  @IsBoolean({ message: 'Terms acceptance must be a boolean.' })
  termsAccepted?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Agree terms must be a boolean.' })
  agreeTerms?: boolean;
}
