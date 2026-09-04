import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

// Mirrors agent/internal/collector.Metric's JSON shape one field at a time.
// Nested collections (supplies/input_trays/alerts/raw) are passed through
// loosely as-is rather than fully typed here - their shape can evolve on the
// agent side faster than this DTO would otherwise track, and they land in
// JSONB columns anyway (see prisma/schema.prisma).
export class IngestMetricDto {
  @IsString()
  device_name: string;

  @IsString()
  host: string;

  @IsISO8601()
  collected_at: string;

  @IsBoolean()
  online: boolean;

  @IsOptional() @IsString() sys_descr?: string;
  @IsOptional() @IsString() sys_name?: string;
  @IsOptional() @IsString() sys_location?: string;
  @IsOptional() @IsString() sys_contact?: string;
  @IsOptional() @IsInt() uptime_ticks?: number;

  @IsOptional() @IsString() printer_name?: string;
  @IsOptional() @IsString() serial_number?: string;
  @IsOptional() @IsString() console_display?: string;

  @IsOptional() @IsInt() printer_status_code?: number;
  @IsOptional() @IsString() printer_status?: string;
  @IsOptional() @IsInt() device_status_code?: number;
  @IsOptional() @IsString() device_status?: string;
  @IsOptional() @IsObject() error_state?: Record<string, boolean>;

  @IsOptional() @IsInt() page_count?: number;
  @IsOptional() @IsInt() power_on_count?: number;
  @IsOptional() @IsInt() mono_page_count?: number;
  @IsOptional() @IsInt() color_page_count?: number;

  // any[] rather than unknown[]: Prisma's Json input type requires each
  // element to be structurally JSON-compatible, which unknown[] can't prove
  // - these are intentionally-loose passthrough fields (see class comment).
  @IsOptional() @IsArray() supplies?: any[];
  @IsOptional() @IsArray() input_trays?: any[];
  @IsOptional() @IsArray() alerts?: any[];
  @IsOptional() @IsObject() raw?: Record<string, string>;

  @IsOptional() @IsString() error?: string;
}

export class IngestPayloadDto {
  // Not trusted for authorization - see AgentAuthGuard/IngestController.
  @IsOptional()
  @IsString()
  tenant_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestMetricDto)
  metrics: IngestMetricDto[];
}
