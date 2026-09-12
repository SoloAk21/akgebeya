import { Router } from 'express';
import { authenticate } from '../auth/middleware.js';
import { requireVerifiedProvider } from '../providers/middleware.js';
import { ProviderRole } from '../generated/prisma/enums.js';
import type { AuthService } from '../auth/service.js';
import type { ProviderService } from '../providers/service.js';
import type { ListingService } from './service.js';
import { listingController } from './controller.js';
export function listingRouter(auth:AuthService,provider:ProviderService,service:ListingService){
 const router=Router(),controller=listingController(service);
 router.use((_req,res,next)=>{res.set('Cache-Control','no-store');res.vary('Authorization');next();});
 router.use(authenticate(auth),requireVerifiedProvider(provider,...Object.values(ProviderRole)));
 router.post('/',controller.create);router.get('/mine',controller.mine);router.get('/:listingId',controller.get);
 router.patch('/:listingId',controller.update);router.delete('/:listingId',controller.remove);
 return router;
}
