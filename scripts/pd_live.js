class TournamentVarianceCalculator {


    static get currencySymbol() {
        return (0).toLocaleString(navigator.language, {
            style                : "currency",
            currency             : "USD",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).replace(/\d/g, "").trim();

    };

    static get showConfidenceIntervals() {return true;};

    static addPayoutoptionsToSelect(elementId, players, selected) {
        let x       = document.getElementById(elementId);
        x.innerHTML = "";
        TournamentVarianceCalculator.initData.paid_places.forEach(e => {
            if (e <= players) {
                let option   = document.createElement("option");
                option.text  = e;
                option.value = e;
                if (e === selected) option.selected = "selected";
                x.add(option);
            }
        });
    }

    static addTournament() {
        TournamentVarianceCalculator.tournaments.push({
            players   : 100,
            placesPaid: 15,
            buyin     : 10,
            rake      : 1,
            roi       : 10,
            number    : 1000
        });
        TournamentVarianceCalculator.displayAllTournaments();
    }

    static cur(n, digits = 0) {
        if (n < 0) return "<span style='color:red'>-" + TournamentVarianceCalculator.cur(-n) + "</span>";
        return Number(n).toLocaleString(navigator.language, {
            style                : "currency",
            currency             : "USD",
            maximumFractionDigits: digits,
            minimumFractionDigits: digits
        });
    }

    static displayAllTournaments() {
        let div = "<h2>Enter tournament data</h2>";
        div += "<form class='input'>";
        for (let i = 0; i < TournamentVarianceCalculator.tournaments.length; i++) {
            div += "<legend>Tournament #" + (i + 1) + "</legend>";
            div += "<fieldset class='with-explanation'>";
            div += "<div><label for=\"players" + i + "\"># of players</label><input type=\"number\" name=\"players" + i + "\" id=\"players" + i + "\" placeholder=\"Players\" value=\"" + TournamentVarianceCalculator.tournaments[i].players + "\" onchange=\"TournamentVarianceCalculator.addPayoutoptionsToSelect('placesPaid" + i + "',this.value,TournamentVarianceCalculator.tournaments[" + i + "].placesPaid); TournamentVarianceCalculator.payoutInfo(" + i + ");\" required/></div>";
            div += "<div><label for=\"placesPaid" + i + "\">Places paid</label><select name=\"placesPaid" + i + "\" id=\"placesPaid" + i + "\" placeholder=\"Places paid\" onchange=\"TournamentVarianceCalculator.payoutInfo(" + i + ");\" required /></select></div>";
            div += "<div><label for=\"buyin" + i + "\">Buyin</label><input type=\"text\" name=\"buyin" + i + "\" id=\"buyin" + i + "\" placeholder=\"Buyin\" value=\"" + TournamentVarianceCalculator.tournaments[i].buyin + "\" onchange=\"TournamentVarianceCalculator.payoutInfo(" + i + ");\" required /><span>in " + TournamentVarianceCalculator.currencySymbol + "</span></div>";
            div += "<div><label for=\"rake" + i + "\">Rake</label><input type=\"text\" name=\"rake" + i + "\" id=\"rake" + i + "\" placeholder=\"Rake (in %)\" value=\"" + TournamentVarianceCalculator.tournaments[i].rake + "\" onchange=\"TournamentVarianceCalculator.payoutInfo(" + i + ");\" /><span>in %</span></div>";
            div += "<div><label for=\"roi" + i + "\">ROI</label><input type=\"text\" name=\"roi" + i + "\" id=\"roi" + i + "\" placeholder=\"Roi\" value=\"" + TournamentVarianceCalculator.tournaments[i].roi + "\"  /><span>Return on investment in %</span></div>";
            div += "<div><label for=\"number" + i + "\">Number</label><input type=\"number\" name=\"number" + i + "\" id=\"number" + i + "\" placeholder=\"Number\" value=\"" + TournamentVarianceCalculator.tournaments[i].number + "\" required /><span>How many are you going play?</span></div>";
            if (TournamentVarianceCalculator.tournaments.length > 1) div += "<div><span></span><button type=\"button\" onclick='TournamentVarianceCalculator.removeTournament(" + i + ")' class='tertiary' >Remove tournament</button></div>";
            div += "</fieldset>";
            div += "<div class='tournament-info' id='tournamentInfo" + i + "'></div>";
        }
        div += "<fieldset class='with-explanation'>";
        div += "<button type=\"button\" onclick=\"TournamentVarianceCalculator.addTournament();\" class='secondary'>Add another tournament type</button>";
        div += "<div><label for=\"sampleSize\">Sample size</label><input type=\"number\" name=\"sampleSize\" id=\"sampleSize\" placeholder=\"Sample size\" value=\"1000\" required /><span>How many samples should be simulated? Careful with large values - it might take a while to calculate the simulations.</em></span></div>";
        div += "<div><label for=\"bankroll\">Bankroll</label><input type=\"number\" name=\"bankroll\" id=\"bankroll\" placeholder=\"Bankroll\" value=\"1000\" /><span>(In " + TournamentVarianceCalculator.currencySymbol + ") - What's your starting bankroll? (can be left empty)</span></div>";
        div += "<div><span></span><button type=\"button\" onclick=\"TournamentVarianceCalculator.tvCalculate();\" >Calculate</button></div>";
        div += "</fieldset>";
        div += "<div class='small-print' id=\"execTime\"></div>";
        div += "</form>";
        document.getElementById("allTournaments").innerHTML = div;
        for (let i = 0; i < TournamentVarianceCalculator.tournaments.length; i++) {
            TournamentVarianceCalculator.addPayoutoptionsToSelect("placesPaid" + i, TournamentVarianceCalculator.tournaments[i].players, TournamentVarianceCalculator.tournaments[i].placesPaid);
            TournamentVarianceCalculator.payoutInfo(i);
        }
    }

    static displayPayoutInfo(info, i) {
        let res = "<details><summary>Payouts for a " + TournamentVarianceCalculator.cur(info.meta.args.buyin) + " tourney with " + TournamentVarianceCalculator.num(info.meta.args.players) + " players</summary>";
        res += "<figure class='explaining-table'><table class=''><thead><tr><th>Place</th><th>Prize</th></tr></thead><tbody>";
        info.payoutInfo.forEach(e => {
            res += "<tr><td>" + e.place + "</td><td>" + TournamentVarianceCalculator.cur(e.prize) + "</td></tr>";
        });
        res += "</tbody></table></figure>";
        res += "<span>The simulation will use this payout table with " + TournamentVarianceCalculator.num(info.meta.args.places_paid) + " players paid and a field of " + TournamentVarianceCalculator.num(info.meta.args.players) + " players for a " + TournamentVarianceCalculator.cur(info.meta.args.buyin) + " tournament (" + TournamentVarianceCalculator.cur(info.meta.args.buyin - info.meta.args.buyin * info.meta.args.rake / 100, 2) + " + " + TournamentVarianceCalculator.cur(info.meta.args.buyin * info.meta.args.rake / 100, 2) + ", " + TournamentVarianceCalculator.num(info.meta.args.rake, 1, true) + " rake).</span></details>";
        document.getElementById("tournamentInfo" + i).innerHTML = res;
    }

    static num(n, digits = 0, pc = false) {
        if (n < 0) return "<span style='color:red'>-" + TournamentVarianceCalculator.num(-n, digits, pc) + "</span>";
        return "" + Number(n).toLocaleString(navigator.language, {
            maximumFractionDigits: digits,
            minimumFractionDigits: digits
        }) + (pc ? "%" : "");
    }

    static payoutInfo(i) {
        let xmlhttp                = new XMLHttpRequest();
        xmlhttp.onreadystatechange = function () {
            if (this.readyState === 4 && this.status === 200) {
                TournamentVarianceCalculator.displayPayoutInfo(JSON.parse(this.responseText), i);
            }
        };
        xmlhttp.open("GET", "/prime.php?p=tournament-variance-calculator&sub_routine=payout_info&args=players=" + document.getElementById("players" + i).value + " places_paid=" + document.getElementById("placesPaid" + i).value + " buyin=" + document.getElementById("buyin" + i).value + " rake=" + document.getElementById("rake" + i).value, true);
        xmlhttp.send();
    }

    static readTournamentInfos() {
        TournamentVarianceCalculator.sampleSize = document.getElementById("sampleSize").value;
        TournamentVarianceCalculator.bankroll   = document.getElementById("bankroll").value;

        for (let i = 0; i < TournamentVarianceCalculator.tournaments.length; i++) {
            TournamentVarianceCalculator.tournaments[i] = (
                {
                    players   : document.getElementById("players" + i).value,
                    placesPaid: document.getElementById("placesPaid" + i).value,
                    buyin     : document.getElementById("buyin" + i).value,
                    rake      : document.getElementById("rake" + i).value,
                    roi       : document.getElementById("roi" + i).value,
                    number    : document.getElementById("number" + i).value
                });
        }
    }

    static removeTournament(i) {
        TournamentVarianceCalculator.tournaments.splice(i, 1);
        TournamentVarianceCalculator.displayAllTournaments();
    }

    static showResults(response) {
        let l   = navigator.language;
        let res = "";
        res += "<h2>Distribution for all tournaments</h2>";
        res += "<div class='content-box'><img class='chart' alt='Chart: Histogram of tournament distributions' title='Chart: Histogram of tournament distributions' src='" + response.histogram + "?t=" + Math.floor(Math.random() * 100000000) + "' /></div>";
        res += "<h2>Random Samples</h2>";
        //res += "<div class='sampleControls'>";
        //res += "<button onclick='tvCalculate(false);'>?</button>";
        //res += "<label for='showConfidenceIntervals'>Show confidence intervals</label><input type='checkbox'
        // id='showConfidenceIntervals' name='showConfidenceIntervals' " + (showConfidenceIntervals ? "checked" : "") +
        // " onchange='showConfidenceIntervals=!showConfidenceIntervals; tvCalculate(false);'>"; res += "</div>";
        res += "<div class='content-box'><img class='chart' alt='Chart: Random samples for tournament distributions' title='Chart: Random samples for tournament distributions' src='" + response.randomRuns + "?t=" + Math.floor(Math.random() * 100000000) + "' /></div>";
        res += "<h2>Statistical Data</h2>";
        res += "<div class='content-box white-color'><h3>Return on investment, EV & SD</h3>";
        res += "<figure class='explaining-table'><table>";
        res += "<tr><td>Tournaments types</td><td> " + TournamentVarianceCalculator.num(response.tournamentTypes) + "</td></tr>";
        res += "<tr><td>Total number of tournaments</td><td> " + TournamentVarianceCalculator.num(response.countTournaments) + "</td></tr>";
        res += "<tr><td>Samplesize</td><td> " + TournamentVarianceCalculator.num(response.samplesize) + "</td></tr>";
        res += "<tr><td>Sum buy-ins</td><td> " + TournamentVarianceCalculator.cur(response.sumBuyins) + "</td></tr>";
        res += "<tr><td>EV (mathematically)</td><td> " + TournamentVarianceCalculator.cur(response.ev) + "</td></tr>";
        res += "<tr><td>EV (simulated)</td><td> " + TournamentVarianceCalculator.cur(response.evSimulated) + "</td></tr>";
        res += "<tr><td>ROI (mathematically)</td><td> " + TournamentVarianceCalculator.num(response.roi * 100, 2, true) + "</td></tr>";
        res += "<tr><td>ROI (simulated)</td><td> " + TournamentVarianceCalculator.num(response.roiSimulated * 100, 2, true) + "</td></tr>";
        res += "<tr><td>SD (mathematically)</td><td> " + TournamentVarianceCalculator.cur(response.sd) + "</td></tr>";
        res += "<tr><td>SD (simulated)</td><td> " + TournamentVarianceCalculator.cur(response.sdSimulated) + "</td></tr>";
        res += "</table></figure>";
        res += "<h3>Confidence Intervals (simulated)</h3>";
        res += "<figure class='wp-block-table'><table class='full-width' ><thead><tr><th>Level</th><th>Confidence Interval</th><th>ROI Interval</th></tr></thead><tbody>";
        res += "<tr><td>70%</td><td>" + TournamentVarianceCalculator.cur(response.conf70[0]) + " - " + TournamentVarianceCalculator.cur(response.conf70[1]) + "</td><td>" + TournamentVarianceCalculator.num(response.conf70roi[0] * 100, 2, true) + " - " + TournamentVarianceCalculator.num(response.conf70roi[1] * 100, 2, true) + "</td></tr>";
        res += "<tr><td>95%</td><td>" + TournamentVarianceCalculator.cur(response.conf95[0]) + " - " + TournamentVarianceCalculator.cur(response.conf95[1]) + "</td><td>" + TournamentVarianceCalculator.num(response.conf95roi[0] * 100, 2, true) + " - " + TournamentVarianceCalculator.num(response.conf95roi[1] * 100, 2, true) + "</td></tr>";
        res += "<tr><td>" + TournamentVarianceCalculator.num(99.7, 1, true) + "</td><td>" + TournamentVarianceCalculator.cur(response.conf997[0]) + " - " + TournamentVarianceCalculator.cur(response.conf997[1]) + "</td><td>" + TournamentVarianceCalculator.num(response.conf997roi[0] * 100, 2, true) + " - " + TournamentVarianceCalculator.num(response.conf997roi[1] * 100, 2, true) + "</td></tr>";
        res += "</tbody></table></figure>";
        res += "<h3>Bankroll & risk of ruin (simulated)</h3>";
        res += "<p>You will need at least the following bankroll depending on the risk of ruin:</p>";
        res += "<figure class='explaining-table'><table ><thead><tr><th>Risk of ruin</th><th>Bankroll needed</th></tr></thead><tbody>";
        res += "<tr><td>50%</td><td>" + TournamentVarianceCalculator.cur(-response.min50percentile) + "</td></tr>";
        res += "<tr><td>15%</td><td>" + TournamentVarianceCalculator.cur(-response.min15percentile) + "</td></tr>";
        res += "<tr><td>5%</td><td>" + TournamentVarianceCalculator.cur(-response.min05percentile) + "</td></tr>";
        res += "<tr><td>1%</td><td>" + TournamentVarianceCalculator.cur(-response.min01percentile) + "</td></tr>";
        if (response.riskOfRuin >= 0)
            res += "<tr><td>Risk of Ruin with " + TournamentVarianceCalculator.cur(bankroll) + " bankroll</td><td>" + TournamentVarianceCalculator.num(response.riskOfRuin * 100, 2, true) + "</td></tr>";
        res += "<tr><td>Simulated runs that never dipped below 0</td><td>" + TournamentVarianceCalculator.num(response.neverBelowZero) + " / " + TournamentVarianceCalculator.num(response.samplesize) + "</td></tr>";
        res += "<tr><td>Probablity of loss after " + TournamentVarianceCalculator.num(response.countTournaments) + " tournaments</td><td>" + TournamentVarianceCalculator.num(response.probLoss * 100, 2, true) + "</td></tr>";
        res += "</tbody></table></figure>";
        res += "</div>";
        document.getElementById("result").innerHTML   = res;
        document.getElementById("execTime").innerHTML = "Calculation time: " + TournamentVarianceCalculator.num(response.meta.exec_time) + "ms";
    }

    static tvCalculate(refresh = true) {
        TournamentVarianceCalculator.readTournamentInfos();
        let params = {
            num_tournaments        : TournamentVarianceCalculator.tournaments.length,
            samples                : TournamentVarianceCalculator.sampleSize,
            bankroll               : TournamentVarianceCalculator.bankroll,
            showConfidenceIntervals: TournamentVarianceCalculator.showConfidenceIntervals
        };
        for (let i = 0; i < TournamentVarianceCalculator.tournaments.length; i++) {
            params["players" + i]     = TournamentVarianceCalculator.tournaments[i].players;
            params["places_paid" + i] = TournamentVarianceCalculator.tournaments[i].placesPaid;
            params["buyin" + i]       = TournamentVarianceCalculator.tournaments[i].buyin;
            params["rake" + i]        = TournamentVarianceCalculator.tournaments[i].rake;
            params["roi" + i]         = TournamentVarianceCalculator.tournaments[i].roi;
            params["number" + i]      = TournamentVarianceCalculator.tournaments[i].number;
        }

        let u                      = new URLSearchParams(params).toString();
        let xmlhttp                = new XMLHttpRequest();
        xmlhttp.onreadystatechange = function () {
            if (this.readyState === 4 && this.status === 200) {
                TournamentVarianceCalculator.showResults(JSON.parse(this.responseText));
            }
        };
        u                          = u.replaceAll("&", " ");
        xmlhttp.open("GET", "/prime.php?p=tournament-variance-calculator&sub_routine=calc&args=" + u, true);
        xmlhttp.send();

    }

    static tvInit() {
        TournamentVarianceCalculator.tournaments = [{
            players   : 100,
            placesPaid: 15,
            buyin     : 50,
            rake      : 11,
            roi       : 10,
            number    : 1000
        }];
        let xmlhttp                              = new XMLHttpRequest();
        xmlhttp.onreadystatechange               = function () {
            if (this.readyState == 4 && this.status == 200) {
                TournamentVarianceCalculator.initData         = JSON.parse(this.responseText);
                TournamentVarianceCalculator.mttPayoutOptions = TournamentVarianceCalculator.initData.paid_places;
                TournamentVarianceCalculator.displayAllTournaments();
                TournamentVarianceCalculator.tvCalculate();
            }

        };

        xmlhttp.open("GET", "/prime.php?p=tournament-variance-calculator&sub_routine=mtt_payout_options", true);
        xmlhttp.send();
    }
}

document.addEventListener("DOMContentLoaded", TournamentVarianceCalculator.tvInit);
