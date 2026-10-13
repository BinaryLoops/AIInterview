import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Data Transfer Object for the login endpoint.
 *
 * Accepts only email and password. All other properties are forbidden by the
 * global ValidationPipe (whitelist: true, forbidNonWhitelisted: true).
 */
export class LoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @IsNotEmpty({ message: 'Email address is required.' })
  @MaxLength(320, { message: 'Email address must not exceed 320 characters.' })
  email!: string;

  @IsString({ message: 'Password must be a string.' })
  @IsNotEmpty({ message: 'Password is required.' })
  @MinLength(1, { message: 'Password must not be empty.' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters.' })
  password!: string;
}
