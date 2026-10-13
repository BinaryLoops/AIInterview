import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Data Transfer Object for revoking an authentication session (logout).
 *
 * For browser clients using HttpOnly cookies, the body field is optional.
 * For native clients (or explicit JSON bodies), strict string, non-empty,
 * and length constraints are enforced.
 */
export class LogoutDto {
  @IsOptional()
  @IsString({ message: 'Refresh token must be a string.' })
  @IsNotEmpty({ message: 'Refresh token must not be empty.' })
  @MaxLength(512, { message: 'Refresh token must not exceed 512 characters.' })
  refreshToken?: string;
}
