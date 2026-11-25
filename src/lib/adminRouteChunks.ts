export const adminChunkLoaders = {
  dashboard: () => import('../pages/admin/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
  productsList: () => import('../pages/admin/products/ProductsListPage').then((m) => ({ default: m.ProductsListPage })),
  productForm: () => import('../pages/admin/products/ProductFormPage').then((m) => ({ default: m.ProductFormPage })),
  productDetail: () => import('../pages/admin/products/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage })),
  attributes: () => import('../pages/admin/products/AttributesPage').then((m) => ({ default: m.AttributesPage })),
  categoriesList: () => import('../pages/admin/categories/CategoriesListPage').then((m) => ({ default: m.CategoriesListPage })),
  categoryForm: () => import('../pages/admin/categories/CategoryFormPage').then((m) => ({ default: m.CategoryFormPage })),
  brandsList: () => import('../pages/admin/brands/BrandsListPage').then((m) => ({ default: m.BrandsListPage })),
  brandForm: () => import('../pages/admin/brands/BrandFormPage').then((m) => ({ default: m.BrandFormPage })),
  inventoryList: () => import('../pages/admin/inventory/InventoryListPage').then((m) => ({ default: m.InventoryListPage })),
  inventoryAdjustments: () =>
    import('../pages/admin/inventory/InventoryAdjustmentsPage').then((m) => ({ default: m.InventoryAdjustmentsPage })),
  inventoryHistory: () =>
    import('../pages/admin/inventory/InventoryHistoryPage').then((m) => ({ default: m.InventoryHistoryPage })),
  heroSlidesList: () => import('../pages/admin/hero-slides/HeroSlidesListPage').then((m) => ({ default: m.HeroSlidesListPage })),
  heroSlideForm: () => import('../pages/admin/hero-slides/HeroSlideFormPage').then((m) => ({ default: m.HeroSlideFormPage })),
  cartHeroSlider: () => import('../pages/admin/hero-slides/CartHeroSliderPage').then((m) => ({ default: m.CartHeroSliderPage })),
  checkoutHeroSlider: () =>
    import('../pages/admin/hero-slides/CheckoutHeroSliderPage').then((m) => ({ default: m.CheckoutHeroSliderPage })),
  wishlistHeroSlider: () =>
    import('../pages/admin/hero-slides/WishlistHeroSliderPage').then((m) => ({ default: m.WishlistHeroSliderPage })),
  bannersList: () => import('../pages/admin/banners/BannersListPage').then((m) => ({ default: m.BannersListPage })),
  bannerForm: () => import('../pages/admin/banners/BannerFormPage').then((m) => ({ default: m.BannerFormPage })),
  advertisementsList: () =>
    import('../pages/admin/advertisements/AdvertisementsListPage').then((m) => ({ default: m.AdvertisementsListPage })),
  advertisementForm: () =>
    import('../pages/admin/advertisements/AdvertisementFormPage').then((m) => ({ default: m.AdvertisementFormPage })),
  ordersList: () => import('../pages/admin/orders/OrdersListPage').then((m) => ({ default: m.OrdersListPage })),
  orderDetail: () => import('../pages/admin/orders/OrderDetailPage').then((m) => ({ default: m.OrderDetailPage })),
  cancellationRequests: () =>
    import('../pages/admin/orders/CancellationRequestsPage').then((m) => ({ default: m.CancellationRequestsPage })),
  returnsRefunds: () => import('../pages/admin/orders/ReturnsRefundsPage').then((m) => ({ default: m.ReturnsRefundsPage })),
  paymentTransactions: () =>
    import('../pages/admin/settings/PaymentTransactionsPage').then((m) => ({ default: m.PaymentTransactionsPage })),
  customersList: () => import('../pages/admin/customers/CustomersListPage').then((m) => ({ default: m.CustomersListPage })),
  customerDetail: () => import('../pages/admin/customers/CustomerDetailPage').then((m) => ({ default: m.CustomerDetailPage })),
  customerGroups: () => import('../pages/admin/customers/CustomerGroupsPage').then((m) => ({ default: m.CustomerGroupsPage })),
  reviewsList: () => import('../pages/admin/reviews/ReviewsListPage').then((m) => ({ default: m.ReviewsListPage })),
  reviewDetail: () => import('../pages/admin/reviews/ReviewDetailPage').then((m) => ({ default: m.ReviewDetailPage })),
  couponsList: () => import('../pages/admin/coupons/CouponsListPage').then((m) => ({ default: m.CouponsListPage })),
  couponForm: () => import('../pages/admin/coupons/CouponFormPage').then((m) => ({ default: m.CouponFormPage })),
  discountRules: () => import('../pages/admin/coupons/DiscountRulesPage').then((m) => ({ default: m.DiscountRulesPage })),
  campaigns: () => import('../pages/admin/coupons/CampaignsPage').then((m) => ({ default: m.CampaignsPage })),
  navigationManager: () => import('../pages/admin/cms/NavigationManagerPage').then((m) => ({ default: m.NavigationManagerPage })),
  homepageCms: () => import('../pages/admin/cms/HomepageCmsPage').then((m) => ({ default: m.HomepageCmsPage })),
  homepageSections: () => import('../pages/admin/cms/HomepageSectionsPage').then((m) => ({ default: m.HomepageSectionsPage })),
  promotionalPopups: () => import('../pages/admin/cms/PromotionalPopupsPage').then((m) => ({ default: m.PromotionalPopupsPage })),
  globalPromotionalPopup: () =>
    import('../pages/admin/marketing/GlobalPromotionalPopupsPage').then((m) => ({
      default: m.GlobalPromotionalPopupsPage,
    })),
  staticPages: () => import('../pages/admin/cms/StaticPagesPage').then((m) => ({ default: m.StaticPagesPage })),
  faqManagement: () => import('../pages/admin/cms/FaqManagementPage').then((m) => ({ default: m.FaqManagementPage })),
  blogManagement: () => import('../pages/admin/cms/BlogManagementPage').then((m) => ({ default: m.BlogManagementPage })),
  supportEnquiries: () => import('../pages/admin/cms/SupportEnquiriesPage').then((m) => ({ default: m.SupportEnquiriesPage })),
  generalSettings: () => import('../pages/admin/settings/GeneralSettingsPage').then((m) => ({ default: m.GeneralSettingsPage })),
  headerSettings: () => import('../pages/admin/settings/HeaderSettingsPage').then((m) => ({ default: m.HeaderSettingsPage })),
  footerSettings: () => import('../pages/admin/settings/FooterSettingsPage').then((m) => ({ default: m.FooterSettingsPage })),
  socialLinks: () => import('../pages/admin/settings/SocialLinksPage').then((m) => ({ default: m.SocialLinksPage })),
  announcementSettings: () =>
    import('../pages/admin/settings/AnnouncementSettingsPage').then((m) => ({ default: m.AnnouncementSettingsPage })),
  seoSettings: () => import('../pages/admin/settings/SeoSettingsPage').then((m) => ({ default: m.SeoSettingsPage })),
  paymentMethods: () => import('../pages/admin/settings/PaymentMethodsPage').then((m) => ({ default: m.PaymentMethodsPage })),
  shippingSettings: () => import('../pages/admin/settings/ShippingSettingsPage').then((m) => ({ default: m.ShippingSettingsPage })),
  deliveryZones: () => import('../pages/admin/settings/DeliveryZonesPage').then((m) => ({ default: m.DeliveryZonesPage })),
  taxSettings: () => import('../pages/admin/settings/TaxSettingsPage').then((m) => ({ default: m.TaxSettingsPage })),
  emailSettings: () => import('../pages/admin/settings/EmailSettingsPage').then((m) => ({ default: m.EmailSettingsPage })),
  notificationsSettings: () =>
    import('../pages/admin/settings/NotificationsSettingsPage').then((m) => ({ default: m.NotificationsSettingsPage })),
  securitySettings: () => import('../pages/admin/settings/SecuritySettingsPage').then((m) => ({ default: m.SecuritySettingsPage })),
  analyticsReport: () => import('../pages/admin/analytics/AnalyticsReportPage').then((m) => ({ default: m.AnalyticsReportPage })),
  adminUsers: () => import('../pages/admin/system/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
  roles: () => import('../pages/admin/system/RolesPage').then((m) => ({ default: m.RolesPage })),
  permissions: () => import('../pages/admin/system/PermissionsPage').then((m) => ({ default: m.PermissionsPage })),
  auditLogs: () => import('../pages/admin/system/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })),
  systemLogs: () => import('../pages/admin/system/SystemLogsPage').then((m) => ({ default: m.SystemLogsPage })),
  systemHealth: () => import('../pages/admin/system/SystemHealthPage').then((m) => ({ default: m.SystemHealthPage })),
} as const;

type AdminLoaderKey = keyof typeof adminChunkLoaders;

const EXACT_ROUTE_TO_LOADER: Record<string, AdminLoaderKey> = {
  '/admin': 'dashboard',
  '/admin/dashboard': 'dashboard',
  '/admin/products': 'productsList',
  '/admin/products/new': 'productForm',
  '/admin/attributes': 'attributes',
  '/admin/attribute-groups': 'attributes',
  '/admin/categories': 'categoriesList',
  '/admin/categories/new': 'categoryForm',
  '/admin/brands': 'brandsList',
  '/admin/brands/new': 'brandForm',
  '/admin/inventory': 'inventoryList',
  '/admin/inventory/adjustments': 'inventoryAdjustments',
  '/admin/inventory/history': 'inventoryHistory',
  '/admin/hero-slides': 'heroSlidesList',
  '/admin/hero-slides/new': 'heroSlideForm',
  '/admin/cart-hero-slider': 'cartHeroSlider',
  '/admin/checkout-hero-slider': 'checkoutHeroSlider',
  '/admin/wishlist-hero-slider': 'wishlistHeroSlider',
  '/admin/banners': 'bannersList',
  '/admin/banners/new': 'bannerForm',
  '/admin/advertisements': 'advertisementsList',
  '/admin/advertisements/new': 'advertisementForm',
  '/admin/marketing/campaigns': 'campaigns',
  '/admin/marketing/global-promotional-popup': 'globalPromotionalPopup',
  '/admin/navigation': 'navigationManager',
  '/admin/cms/popups': 'promotionalPopups',
  '/admin/orders': 'ordersList',
  '/admin/orders/pending': 'ordersList',
  '/admin/orders/processing': 'ordersList',
  '/admin/orders/shipped': 'ordersList',
  '/admin/orders/delivered': 'ordersList',
  '/admin/orders/cancelled': 'ordersList',
  '/admin/orders/cancellation-requests': 'cancellationRequests',
  '/admin/returns': 'returnsRefunds',
  '/admin/payments': 'paymentTransactions',
  '/admin/customers': 'customersList',
  '/admin/customer-groups': 'customerGroups',
  '/admin/reviews': 'reviewsList',
  '/admin/support': 'supportEnquiries',
  '/admin/coupons': 'couponsList',
  '/admin/coupons/new': 'couponForm',
  '/admin/discount-rules': 'discountRules',
  '/admin/special-offers': 'campaigns',
  '/admin/flash-sales': 'campaigns',
  '/admin/homepage-layout': 'homepageSections',
  '/admin/cms/homepage': 'homepageCms',
  '/admin/cms/sections': 'homepageSections',
  '/admin/cms/pages': 'staticPages',
  '/admin/cms/faqs': 'faqManagement',
  '/admin/cms/blogs': 'blogManagement',
  '/admin/settings/header': 'headerSettings',
  '/admin/settings/footer': 'footerSettings',
  '/admin/settings/announcement': 'announcementSettings',
  '/admin/settings/social-links': 'socialLinks',
  '/admin/payments/methods': 'paymentMethods',
  '/admin/shipping': 'shippingSettings',
  '/admin/shipping/zones': 'deliveryZones',
  '/admin/settings/tax': 'taxSettings',
  '/admin/settings/general': 'generalSettings',
  '/admin/settings/email': 'emailSettings',
  '/admin/settings/notifications': 'notificationsSettings',
  '/admin/settings/seo': 'seoSettings',
  '/admin/settings/security': 'securitySettings',
  '/admin/analytics/sales': 'analyticsReport',
  '/admin/analytics/revenue': 'analyticsReport',
  '/admin/analytics/products': 'analyticsReport',
  '/admin/analytics/customers': 'analyticsReport',
  '/admin/analytics/inventory': 'analyticsReport',
  '/admin/admin-users': 'adminUsers',
  '/admin/roles': 'roles',
  '/admin/permissions': 'permissions',
  '/admin/audit-logs': 'auditLogs',
  '/admin/system-logs': 'systemLogs',
  '/admin/system-health': 'systemHealth',
};

const prefetchedLoaders = new Set<AdminLoaderKey>();

export function resolveAdminChunkKey(pathname: string): AdminLoaderKey | null {
  const clean = pathname.split('?')[0].replace(/\/+$/, '') || '/admin';
  const exact = EXACT_ROUTE_TO_LOADER[clean];
  if (exact) return exact;

  if (/^\/admin\/products\/[^/]+\/edit$/.test(clean)) return 'productForm';
  if (/^\/admin\/products\/[^/]+$/.test(clean)) return 'productDetail';
  if (/^\/admin\/categories\/[^/]+\/edit$/.test(clean)) return 'categoryForm';
  if (/^\/admin\/brands\/[^/]+\/edit$/.test(clean)) return 'brandForm';
  if (/^\/admin\/hero-slides\/[^/]+\/edit$/.test(clean)) return 'heroSlideForm';
  if (/^\/admin\/banners\/[^/]+\/edit$/.test(clean)) return 'bannerForm';
  if (/^\/admin\/advertisements\/[^/]+\/edit$/.test(clean)) return 'advertisementForm';
  if (/^\/admin\/orders\/[^/]+$/.test(clean)) return 'orderDetail';
  if (/^\/admin\/customers\/[^/]+$/.test(clean)) return 'customerDetail';
  if (/^\/admin\/reviews\/[^/]+$/.test(clean)) return 'reviewDetail';
  if (/^\/admin\/coupons\/[^/]+\/edit$/.test(clean)) return 'couponForm';

  return null;
}

export function prefetchAdminRoute(pathname: string): void {
  const key = resolveAdminChunkKey(pathname);
  if (!key || prefetchedLoaders.has(key)) return;
  prefetchedLoaders.add(key);
  void adminChunkLoaders[key]().catch(() => {
    prefetchedLoaders.delete(key);
  });
}
