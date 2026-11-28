// Synthetic names, geometry and non-dialable references. Never send this fixture to external providers.
const catalogs=[
  ["Cedar Depot","Fern Square","Amber Park","Maple Court","Demo Campus"],
  ["Quartz Depot","Juniper Plaza","Coral Library","Aster Circle","Demo Campus"],
  ["Linden Depot","Birch Corner","Orchid Walk","Saffron Plaza","Demo Campus"],
  ["Indigo Depot","Silver Walk","Lotus Court","Moss Square","Demo Campus"],
];
export const fictionalTransportRoutes=catalogs.map((route,i)=>({
  code:`SIM-${i+1}`,title:`Fictional ${route[0].split(" ")[0]} line`,direction:"inbound" as const,
  departure:`07:${20+i*5}`,weekday:3,
  stops:route.map((label,j)=>({label,lat:Number((12.25+0.004*j).toFixed(6)),lon:Number((76.60+0.005*(i+1)*(4-j)).toFixed(6)),offset:j*5})),
  vehicle:{title:`Fictional Bus ${i+1}`,seats:32+i,capacity:36+i},
  driver:i<3?`DEMO-DRIVER-${i+1}`:null,
}));
export const fictionalRiderChoices=[
  [0,1],[0,1],[0,2],[1,0],[1,1],[1,3],[2,1],[2,2],[3,0],[3,3],
].map(([route,stop],i)=>({rider:`DEMO-RIDER-${String(i+1).padStart(2,"0")}`,routeCode:fictionalTransportRoutes[route].code,stopLabel:fictionalTransportRoutes[route].stops[stop].label}));
