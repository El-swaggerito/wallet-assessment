import { Body, Controller, Post } from "@nestjs/common";
import { ProviderEventDto } from "./dto/provider-event.dto.js";
import { ProviderService } from "./provider.service.js";

@Controller("provider")
export class ProviderController {
  constructor(private readonly providerService: ProviderService) {}

  @Post("events")
  processEvent(@Body() event: ProviderEventDto) {
    return this.providerService.processEvent(event);
  }
}
