import qs from "qs";
import minimist from "minimist";
import { price } from "../format";

console.log(price(1), qs.stringify({ a: 1 }), minimist([]));
