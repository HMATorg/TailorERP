import { Module } from '@nestjs/common';
import { ZatcaModule } from '../zatca/zatca.module';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  // Creating an invoice and issuing it to ZATCA are one operation in KSA: the
  // document is not a tax invoice until it has a VAT split and a QR.
  imports: [ZatcaModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicePdfService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
